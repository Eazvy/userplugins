/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { MessageActions, SelectedChannelStore } from "@webpack/common";

const logger = new Logger("PerformanceOptimizer");

type ChannelSelectEvent = { channelId?: string | null; };
const LATENCY_SAFE_MIN_MESSAGES_TO_KEEP = 150;
const LATENCY_SAFE_MIN_WARM_MESSAGES_TO_KEEP = 300;
const LATENCY_SAFE_MIN_PRUNE_DELAY_MS = 180_000;
const LATENCY_SAFE_MIN_MAX_CACHED_CHANNELS = 30;
const LATENCY_SAFE_MIN_INACTIVE_BEFORE_PRUNE_MS = 600_000;

const settings = definePluginSettings({
    instantStartupMode: {
        type: OptionType.BOOLEAN,
        description: "Aggressively optimize startup by skipping non-essential visuals and smooth-scroll effects.",
        default: true,
        restartNeeded: true
    },
    aggressiveBootOptimizations: {
        type: OptionType.BOOLEAN,
        description: "Further reduce startup/runtime CPU by skipping presence and member list update handlers.",
        default: false,
        restartNeeded: true
    },
    enableChannelCachePruning: {
        type: OptionType.BOOLEAN,
        description: "Enable pruning old channel message caches (can increase channel/media reload latency).",
        default: false,
        restartNeeded: false
    },
    disableMemberListUpdates: {
        type: OptionType.BOOLEAN,
        description: "Disable guild member list update handling to reduce CPU spikes in large servers.",
        default: false,
        restartNeeded: false
    },
    disablePresenceUpdates: {
        type: OptionType.BOOLEAN,
        description: "Disable presence update handling (online/activity) to reduce background processing.",
        default: false,
        restartNeeded: false
    },
    disableTypingIndicators: {
        type: OptionType.BOOLEAN,
        description: "Disable typing indicator processing to reduce channel list/store churn.",
        default: false,
        restartNeeded: true
    },
    disableVoiceConnectionStats: {
        type: OptionType.BOOLEAN,
        description: "Disable voice connection stats processing to reduce CPU usage during voice activity.",
        default: false,
        restartNeeded: true
    },
    disableVoiceStateUpdates: {
        type: OptionType.BOOLEAN,
        description: "Disable non-essential voice state update processing to reduce CPU usage in large voice servers.",
        default: false,
        restartNeeded: true
    },
    disableVoiceVideoUpdates: {
        type: OptionType.BOOLEAN,
        description: "Disable voice video sink/size update processing to reduce CPU usage during video activity.",
        default: false,
        restartNeeded: true
    },
    disablePassiveUpdateHandlers: {
        type: OptionType.BOOLEAN,
        description: "Disable selected PASSIVE_UPDATE_V2 handlers to reduce background CPU usage.",
        default: false,
        restartNeeded: true
    },
    optimizeReactSyncUpdates: {
        type: OptionType.BOOLEAN,
        description: "Reduce React flushSync usage in selected UI paths to lower CPU spikes.",
        default: true,
        restartNeeded: true
    },
    optimizeResizeObserverState: {
        type: OptionType.BOOLEAN,
        description: "Skip redundant width/height setState calls from ResizeObserver callbacks.",
        default: true,
        restartNeeded: true
    },
    fastChannelLoadMode: {
        type: OptionType.BOOLEAN,
        description: "Reduce initial channel fetch workload for faster perceived channel opening.",
        default: true,
        restartNeeded: true
    },
    channelInitialFetchLimit: {
        type: OptionType.SLIDER,
        description: "Initial messages to fetch per channel switch (lower = faster open, less preloaded history).",
        default: 30,
        markers: [15, 20, 25, 30, 40, 50],
        stickToMarkers: true,
        restartNeeded: true
    },
    skipInitialScrollOnChannelOpen: {
        type: OptionType.BOOLEAN,
        description: "Skip initial channel scroll positioning work for faster channel open.",
        default: true,
        restartNeeded: true
    },
    maxCachedChannels: {
        type: OptionType.SLIDER,
        description: "Number of recently visited channels to keep fully cached.",
        default: 20,
        markers: [3, 5, 10, 15, 20, 25, 30],
        stickToMarkers: true,
        restartNeeded: false
    },
    messagesToKeep: {
        type: OptionType.SLIDER,
        description: "Number of messages to keep in pruned channels.",
        default: 80,
        markers: [10, 20, 30, 50, 75, 100],
        stickToMarkers: true,
        restartNeeded: false
    },
    pruneDelayMs: {
        type: OptionType.SLIDER,
        description: "Delay before pruning stale channels (ms).",
        default: 60_000,
        markers: [5_000, 10_000, 15_000, 30_000, 60_000],
        stickToMarkers: true,
        restartNeeded: false
    },
    warmMessagesToKeep: {
        type: OptionType.SLIDER,
        description: "Messages kept on first prune to reduce revisit re-fetch delay.",
        default: 300,
        markers: [100, 150, 200, 250, 300, 400, 500],
        stickToMarkers: true,
        restartNeeded: false
    },
    minInactiveBeforePruneMs: {
        type: OptionType.SLIDER,
        description: "Inactive before prune (seconds).",
        default: 600,
        markers: [120, 300, 600, 900, 1_800],
        stickToMarkers: true,
        restartNeeded: false
    }
});

function getSafeMaxCachedChannels() {
    if (!settings.store.enableChannelCachePruning) return Math.max(1, Math.floor(settings.store.maxCachedChannels));
    return Math.max(LATENCY_SAFE_MIN_MAX_CACHED_CHANNELS, Math.floor(settings.store.maxCachedChannels));
}

function getSafeMessagesToKeep() {
    if (!settings.store.enableChannelCachePruning) return Math.max(1, Math.floor(settings.store.messagesToKeep));
    return Math.max(LATENCY_SAFE_MIN_MESSAGES_TO_KEEP, Math.floor(settings.store.messagesToKeep));
}

function getSafePruneDelayMs() {
    if (!settings.store.enableChannelCachePruning) return Math.max(0, Math.floor(settings.store.pruneDelayMs));
    return Math.max(LATENCY_SAFE_MIN_PRUNE_DELAY_MS, Math.floor(settings.store.pruneDelayMs));
}

function getSafeWarmMessagesToKeep() {
    const warmFloor = settings.store.enableChannelCachePruning
        ? LATENCY_SAFE_MIN_WARM_MESSAGES_TO_KEEP
        : getSafeMessagesToKeep();
    return Math.max(warmFloor, getSafeMessagesToKeep(), Math.floor(settings.store.warmMessagesToKeep));
}

function getSafeMinInactiveBeforePruneMs() {
    const raw = Math.floor(settings.store.minInactiveBeforePruneMs);
    const seconds = raw > 10_000 ? Math.floor(raw / 1_000) : raw;
    const valueMs = Math.max(0, seconds) * 1_000;

    if (!settings.store.enableChannelCachePruning) return valueMs;
    return Math.max(LATENCY_SAFE_MIN_INACTIVE_BEFORE_PRUNE_MS, valueMs);
}

function getColdPruneDelayMs() {
    return Math.max(180_000, getSafePruneDelayMs() * 8);
}

const pendingPrunes = new Map<string, ReturnType<typeof setTimeout>>();
const visitedChannels = new Set<string>();
const warmPrunedChannels = new Set<string>();
const lastChannelActivity = new Map<string, number>();
let lastSelectedChannelId: string | null = null;
let pendingPruneCheckTimer: ReturnType<typeof setTimeout> | null = null;
let wasPruningEnabled = false;

function clearPendingPrune(channelId: string) {
    const timer = pendingPrunes.get(channelId);
    if (!timer) return;

    clearTimeout(timer);
    pendingPrunes.delete(channelId);
}

function enqueueVisited(channelId: string) {
    visitedChannels.delete(channelId);
    visitedChannels.add(channelId);
    lastChannelActivity.set(channelId, Date.now());
}

function wasInactiveLongEnough(channelId: string) {
    const lastActive = lastChannelActivity.get(channelId) ?? 0;
    return Date.now() - lastActive >= getSafeMinInactiveBeforePruneMs();
}

function pruneIfNeeded() {
    const maxCachedChannels = getSafeMaxCachedChannels();
    while (visitedChannels.size > maxCachedChannels) {
        const staleChannelId = visitedChannels.values().next().value as string | undefined;
        if (!staleChannelId) break;

        if (!wasInactiveLongEnough(staleChannelId)) break;

        visitedChannels.delete(staleChannelId);
        schedulePrune(staleChannelId);
    }
}

function schedulePruneCheck() {
    if (pendingPruneCheckTimer) return;

    pendingPruneCheckTimer = setTimeout(() => {
        pendingPruneCheckTimer = null;
        pruneIfNeeded();
    }, 0);
}

function schedulePrune(channelId: string) {
    if (!channelId) return;

    clearPendingPrune(channelId);

    const timer = setTimeout(() => {
        try {
            if (!settings.store.enableChannelCachePruning) return;

            const currentChannelId = SelectedChannelStore.getChannelId();
            if (channelId === currentChannelId) {
                enqueueVisited(channelId);
                pruneIfNeeded();
                return;
            }

            if (!wasInactiveLongEnough(channelId)) {
                enqueueVisited(channelId);
                pruneIfNeeded();
                return;
            }

            const hasWarmPruned = warmPrunedChannels.has(channelId);
            const messagesToKeep = hasWarmPruned ? getSafeMessagesToKeep() : getSafeWarmMessagesToKeep();

            MessageActions.truncateMessages(channelId, messagesToKeep, false);

            if (!hasWarmPruned && messagesToKeep > getSafeMessagesToKeep()) {
                warmPrunedChannels.add(channelId);
                scheduleColdPrune(channelId);
            }
        } catch (error) {
            logger.error(`Failed to prune channel ${channelId}:`, error);
        } finally {
            if (pendingPrunes.get(channelId) === timer) pendingPrunes.delete(channelId);
        }
    }, getSafePruneDelayMs());

    pendingPrunes.set(channelId, timer);
}

function scheduleColdPrune(channelId: string) {
    if (!channelId) return;

    clearPendingPrune(channelId);

    const timer = setTimeout(() => {
        try {
            if (!settings.store.enableChannelCachePruning) return;

            const currentChannelId = SelectedChannelStore.getChannelId();
            if (channelId === currentChannelId) {
                warmPrunedChannels.delete(channelId);
                return;
            }

            if (visitedChannels.has(channelId)) {
                warmPrunedChannels.delete(channelId);
                return;
            }

            if (!wasInactiveLongEnough(channelId)) {
                warmPrunedChannels.delete(channelId);
                return;
            }

            const messagesToKeep = getSafeMessagesToKeep();
            MessageActions.truncateMessages(channelId, messagesToKeep, false);
        } catch (error) {
            logger.error(`Failed cold-prune for channel ${channelId}:`, error);
        } finally {
            if (pendingPrunes.get(channelId) === timer) pendingPrunes.delete(channelId);
            warmPrunedChannels.delete(channelId);
        }
    }, getColdPruneDelayMs());

    pendingPrunes.set(channelId, timer);
}

function clearRuntimeState() {
    for (const timer of pendingPrunes.values()) clearTimeout(timer);
    pendingPrunes.clear();
    if (pendingPruneCheckTimer) {
        clearTimeout(pendingPruneCheckTimer);
        pendingPruneCheckTimer = null;
    }
    lastSelectedChannelId = null;
    wasPruningEnabled = false;
    visitedChannels.clear();
    warmPrunedChannels.clear();
    lastChannelActivity.clear();
}

export default definePlugin({
    name: "PerformanceOptimizer",
    description: "Prunes stale channel caches and applies performance patches.",
    authors: [
        EquicordDevs.omaw,
        {
            name: "dxrx99",
            id: 1463629522359423152n
        },
        {
            name: "awizz",
            id: 1267951485585461288n
        }
    ],
    requiresRestart: true,
    settings,
    shouldSkipPresenceUpdates() {
        return settings.store.disablePresenceUpdates || settings.store.aggressiveBootOptimizations;
    },
    shouldSkipMemberListUpdates() {
        return settings.store.disableMemberListUpdates || settings.store.aggressiveBootOptimizations;
    },
    shouldSkipTypingUpdates() {
        return settings.store.disableTypingIndicators;
    },
    shouldSkipVoiceConnectionStats() {
        return settings.store.disableVoiceConnectionStats;
    },
    shouldSkipVoiceStateUpdates() {
        return settings.store.disableVoiceStateUpdates;
    },
    shouldSkipVoiceVideoUpdates() {
        return settings.store.disableVoiceVideoUpdates;
    },
    shouldSkipPassiveUpdates() {
        return settings.store.disablePassiveUpdateHandlers;
    },
    shouldOptimizeReactSyncUpdates() {
        return settings.store.optimizeReactSyncUpdates;
    },
    shouldOptimizeResizeObserverState() {
        return settings.store.optimizeResizeObserverState;
    },
    getScrollBehavior(reducedMotion: boolean) {
        return this.isInstantStartupMode() ? "auto" : reducedMotion ? "auto" : "smooth";
    },
    isInstantStartupMode() {
        return settings.store.instantStartupMode;
    },
    wrapTypingHandler(handler: (event: unknown) => unknown) {
        return (event: unknown) => this.shouldSkipTypingUpdates() ? void 0 : handler(event);
    },
    wrapMemberListHandler(handler: (event: unknown) => unknown) {
        return (event: unknown) => this.shouldSkipMemberListUpdates() ? void 0 : handler(event);
    },

    patches: [
        {
            find: "=\"NowPlayingStore\"",
            group: true,
            replacement: [
                {
                    match: /CONNECTION_OPEN_SUPPLEMENTAL:function\((\i)\)\{/,
                    replace: "CONNECTION_OPEN_SUPPLEMENTAL:function($1){if($self.shouldSkipPresenceUpdates())return;"
                },
                {
                    match: /PRESENCE_UPDATES:function\((\i)\)\{/,
                    replace: "PRESENCE_UPDATES:function($1){if($self.shouldSkipPresenceUpdates())return;"
                },
                {
                    match: /PRESENCES_REPLACE:function\((\i)\)\{/,
                    replace: "PRESENCES_REPLACE:function($1){if($self.shouldSkipPresenceUpdates())return;"
                },
                {
                    match: /(\i)=\{\.\.\.\1,\[(\i)\]:\{\.\.\.\1\[\2\],\[(\i)\.userId\]:(\i)\}\},/,
                    replace: "$1[$2]={...$1[$2],[$3.userId]:$4},"
                },
                {
                    match: /(\i)=\{\.\.\.\1,\[(\i)\.userId\]:\{gameId:(\i),startedPlaying:\2\.startedPlaying\}\},!0/,
                    replace: "$1[$2.userId]={gameId:$3,startedPlaying:$2.startedPlaying},!0"
                }
            ]
        },
        {
            find: "ONLINE_GUILD_MEMBER_COUNT_UPDATE:",
            noWarn: true,
            replacement: {
                match: /ONLINE_GUILD_MEMBER_COUNT_UPDATE:(\i)/,
                replace: "ONLINE_GUILD_MEMBER_COUNT_UPDATE:$self.wrapMemberListHandler($1)"
            }
        },
        {
            find: /displayName="TypingStore".{0,260}TYPING_START:\i,TYPING_STOP:\i,TYPING_START_LOCAL:\i,TYPING_STOP_LOCAL:\i,/,
            replacement: {
                match: /TYPING_START:(\i),TYPING_STOP:(\i),TYPING_START_LOCAL:(\i),TYPING_STOP_LOCAL:(\i),/,
                replace: "TYPING_START:$self.wrapTypingHandler($1),TYPING_STOP:$self.wrapTypingHandler($2),TYPING_START_LOCAL:$self.wrapTypingHandler($3),TYPING_STOP_LOCAL:$self.wrapTypingHandler($4),"
            }
        },
        {
            find: /ACTIVE_NOW".{0,120}DMS".{0,120}RECENT_TEXT".{0,2400}MESSAGE_ACK:\i\(function\(e\)\{return \i\(e\.channelId\)\}\),TYPING_START:\i\(function\(e\)\{var \i=e\.channelId;/,
            replacement: {
                match: /TYPING_START:(\i)\(function\(e\)\{var (\i)=e\.channelId;/,
                replace: "TYPING_START:$1(function(e){if($self.shouldSkipTypingUpdates())return!1;var $2=e.channelId;"
            }
        },
        {
            find: /prunable&&\i\.delete\(e\.channelId\),\i\(\),!0\}\),TYPING_START:\i\(function\(e\)\{if\(!\i\)return!1;/,
            replacement: {
                match: /TYPING_START:(\i)\(function\(e\)\{if\(!(\i)\)return!1;/,
                replace: "TYPING_START:$1(function(e){if($self.shouldSkipTypingUpdates())return!1;if(!$2)return!1;"
            }
        },
        {
            find: "handleStats,POST_CONNECTION_OPEN",
            noWarn: true,
            replacement: {
                match: /MEDIA_ENGINE_CONNECTION_STATS:this\.handleStats,/,
                replace: "MEDIA_ENGINE_CONNECTION_STATS:e=>$self.shouldSkipVoiceConnectionStats()?void 0:this.handleStats(e),"
            }
        },
        {
            find: /RTC_CONNECTION_REMOTE_VIDEO_SINK_WANTS:\i,VIDEO_SIZE_UPDATE:\i,VOICE_STATE_UPDATES:\i,VOICE_CHANNEL_SELECT:\i,AUDIO_SET_NOISE_CANCELLATION:\i,/,
            noWarn: true,
            group: true,
            replacement: [
                {
                    match: /RTC_CONNECTION_REMOTE_VIDEO_SINK_WANTS:(\i),VIDEO_SIZE_UPDATE:(\i),/,
                    replace: "RTC_CONNECTION_REMOTE_VIDEO_SINK_WANTS:e=>$self.shouldSkipVoiceVideoUpdates()?void 0:$1(e),VIDEO_SIZE_UPDATE:e=>$self.shouldSkipVoiceVideoUpdates()?void 0:$2(e),"
                },
                {
                    match: /VOICE_STATE_UPDATES:(\i),VOICE_CHANNEL_SELECT:(\i),/,
                    replace: "VOICE_STATE_UPDATES:e=>$self.shouldSkipVoiceStateUpdates()?void 0:$1(e),VOICE_CHANNEL_SELECT:$2,"
                }
            ]
        },
        {
            find: "PASSIVE_UPDATE_V2:function(e){let t=A.A.getGuild(e.guildId);",
            noWarn: true,
            replacement: {
                match: /PASSIVE_UPDATE_V2:function\(e\)\{let (\i)=(\i)\.(\i)\.getGuild\(e\.guildId\);/,
                replace: "PASSIVE_UPDATE_V2:function(e){if($self.shouldSkipPassiveUpdates())return!1;let $1=$2.$3.getGuild(e.guildId);"
            }
        },
        {
            find: "PASSIVE_UPDATE_V2:function(e){return G.clearGuildId(e.guildId)},RECOMPUTE_READ_STATES:",
            noWarn: true,
            replacement: {
                match: /PASSIVE_UPDATE_V2:function\(e\)\{return (\i)\.clearGuildId\(e\.guildId\)\},/,
                replace: "PASSIVE_UPDATE_V2:function(e){if($self.shouldSkipPassiveUpdates())return;return $1.clearGuildId(e.guildId)},"
            }
        },
        {
            find: "PASSIVE_UPDATE_V2:()=>this.syncHeartbeats([r.n.STREAM_ON_DESKTOP],\"PASSIVE_UPDATE_V2\"),VOICE_STATE_UPDATES:",
            noWarn: true,
            group: true,
            replacement: [
                {
                    match: /PASSIVE_UPDATE_V2:\(\)=>this\.syncHeartbeats\((\[[^\]]+\]),"PASSIVE_UPDATE_V2"\),/,
                    replace: "PASSIVE_UPDATE_V2:()=>$self.shouldSkipPassiveUpdates()?void 0:this.syncHeartbeats($1,\"PASSIVE_UPDATE_V2\"),"
                },
                {
                    match: /VOICE_STATE_UPDATES:\(\)=>this\.syncHeartbeats\((\[[^\]]+\]),"VOICE_STATE_UPDATES"\),/,
                    replace: "VOICE_STATE_UPDATES:()=>$self.shouldSkipVoiceStateUpdates()?void 0:this.syncHeartbeats($1,\"VOICE_STATE_UPDATES\"),"
                }
            ]
        },
        {
            find: "MessageManager.initialFetch",
            replacement: {
                match: /limit:\(0,(\i)\.(\i)\)\("MessageManager\.initialFetch"\),/,
                replace: "limit:$self.settings.store.fastChannelLoadMode?Math.max(15,Math.floor($self.settings.store.channelInitialFetchLimit)):(0,$1.$2)(\"MessageManager.initialFetch\"),"
            }
        },
        {
            find: "this.rebuildFavoriteEmojisWithoutFetchingLatest()",
            replacement: {
                match: /(\((\i)\.(\i)\.frecencyWithoutFetchingLatest\.favoriteEmojis\?\.emojis\?\?\[\]\))\.map\((\i)=>this\.getById\(\4\)\?\?(\i)\.(\i)\.getByName\(\4\)\)\.filter\((\i)\.(\i)\)/,
                replace: "(e=>{let t=[],n=0;for(;n<e.length;n++){let r=e[n],i=this.getById(r)??$5.$6.getByName(r);$7.$8(i)&&t.push(i)}return t})($1)"
            }
        },
        {
            find: "getAppSpinnerSources()",
            noWarn: true,
            replacement: {
                match: /let (\i)=\i\.\i\.getAppSpinnerSources\(\),(\i)=null!=\1\?(\i)\(\1\):null,(\i)=\3\(\{\}\),/,
                replace: "let $1=null,$2=null,$4=$3({}),"
            }
        },
        {
            find: "getAppSpinnerSources()",
            noWarn: true,
            replacement: {
                match: /return\((\i)>52\|\|-1===\1\)&&\(.{1,260}?\),\(0,(\i)\.TM\)\(\)&&\(.{1,260}?\),\{/,
                replace: "return{"
            }
        },
        {
            find: /confetti:\i,spriteCanvas:\i\}\),null==\i\.current&&\i\(\)/,
            noWarn: true,
            group: true,
            replacement: [
                {
                    match: /\i\.createElement\("canvas",_\(\{\},\i,\{className:\i,ref:\i\}\)\)/,
                    replace: "$self.isInstantStartupMode()?null:$&"
                },
                {
                    match: /\i\.createElement\("canvas",\{ref:\i,className:\i,style:\i\?void 0:\i\}\)/,
                    replace: "$self.isInstantStartupMode()?null:$&"
                }
            ]
        },
        {
            find: "combosRequiredCount:5",
            group: true,
            replacement: [
                {
                    match: /combosEnabled:!0,combosRequiredCount:5,/,
                    replace: "combosEnabled:$self.isInstantStartupMode()?!1:!0,combosRequiredCount:5,"
                },
                {
                    match: /comboSoundsEnabled:!0,screenshakeEnabled:!0,/,
                    replace: "comboSoundsEnabled:$self.isInstantStartupMode()?!1:!0,screenshakeEnabled:!0,"
                },
                {
                    match: /screenshakeEnabled:!0,screenshakeEnabledLocations:/,
                    replace: "screenshakeEnabled:$self.isInstantStartupMode()?!1:!0,screenshakeEnabledLocations:"
                },
                {
                    match: /shakeIntensity:1,confettiEnabled:!0,/,
                    replace: "shakeIntensity:1,confettiEnabled:$self.isInstantStartupMode()?!1:!0,"
                }
            ]
        },
        {
            find: "getDispatchHandler needs to be passed in first!",
            replacement: {
                match: /(\.flush\(\i,\i\),"READY"===\i\)\{).{1,1200}?;(.{1,500}?\)),.{1,400}?\}/,
                replace: "$1$2}"
            }
        },
        {
            find: /requestAnimationFrame\(\(\)=>\{\i\.scrollIntoView\(\{behavior:\i\?"auto":"smooth"\}\)\}\);return\(\)=>cancelAnimationFrame\(\i\)/,
            replacement: {
                match: /let \i=requestAnimationFrame\(\(\)=>\{(\i)\.scrollIntoView\(\{behavior:(\i)\?"auto":"smooth"\}\)\}\);return\(\)=>cancelAnimationFrame\(\i\)/,
                replace: "$1.scrollIntoView({behavior:$self.getScrollBehavior($2)})"
            }
        },
        {
            find: "this.state.shouldShowTooltip!==",
            noWarn: true,
            group: true,
            replacement: [
                {
                    match: /(\i)\.flushSync\(\(\)=>\{this\.setState\(\{shouldShowTooltip:(\i)\}\)\}\)/,
                    replace: "$self.shouldOptimizeReactSyncUpdates()?(this.__open=$2,this.setState({shouldShowTooltip:$2})):$1.flushSync(()=>{this.setState({shouldShowTooltip:$2})})"
                },
                {
                    match: /this\.state\.shouldShowTooltip!==(\i)&&/,
                    replace: "($self.shouldOptimizeReactSyncUpdates()?this.__open:this.state.shouldShowTooltip)!==$1&&"
                }
            ]
        },
        {
            find: "this.resizeObserver=new t.ResizeObserver(()=>{u.flushSync(()=>{this.setState({resizeKey:this.state.resizeKey+1})})})",
            noWarn: true,
            replacement: {
                match: /(\i)\.flushSync\(\(\)=>\{this\.setState\(\{resizeKey:this\.state\.resizeKey\+1\}\)\}\)/,
                replace: "$self.shouldOptimizeReactSyncUpdates()?this.setState({resizeKey:this.state.resizeKey+1}):$1.flushSync(()=>{this.setState({resizeKey:this.state.resizeKey+1})})"
            }
        },
        {
            find: "devicePixelRatio||1}function c(e,t)",
            noWarn: true,
            replacement: {
                match: /(\i)\.flushSync\(\(\)=>\{(\i)\((\i)\)\}\)/,
                replace: "$self.shouldOptimizeReactSyncUpdates()?$2($3):$1.flushSync(()=>{$2($3)})"
            }
        },
        {
            find: "name:\"updateState\",enabled:!0,phase:\"write\",fn:function(e){",
            noWarn: true,
            replacement: {
                match: /(\i)\.flushSync\(function\(\)\{((\i)\(\{.{0,420}?\}\))\}\)/,
                replace: "$self.shouldOptimizeReactSyncUpdates()?$2:$1.flushSync(function(){$2})"
            }
        },
        {
            find: "selectedVoiceChannelId:N.A.getVoiceChannelId()",
            noWarn: true,
            replacement: {
                match: /(\i)\(\{width:(\i)\.current\?\.clientWidth\?\?0,height:\2\.current\?\.clientHeight\?\?0\}\)/,
                replace: "$self.shouldOptimizeResizeObserverState()?$1(e=>{let t=$2.current?.clientWidth??0,n=$2.current?.clientHeight??0;return e.width===t&&e.height===n?e:{width:t,height:n}}):$1({width:$2.current?.clientWidth??0,height:$2.current?.clientHeight??0})"
            }
        },
        {
            find: "ResizeObserver(()=>{es({width:ei.current?.clientWidth??0,height:ei.current?.clientHeight??0})})",
            noWarn: true,
            replacement: {
                match: /(\i)\(\{width:(\i)\.current\?\.clientWidth\?\?0,height:\2\.current\?\.clientHeight\?\?0\}\)/,
                replace: "$self.shouldOptimizeResizeObserverState()?$1(e=>{let t=$2.current?.clientWidth??0,n=$2.current?.clientHeight??0;return e.width===t&&e.height===n?e:{width:t,height:n}}):$1({width:$2.current?.clientWidth??0,height:$2.current?.clientHeight??0})"
            }
        }
    ],

    flux: {
        CHANNEL_SELECT({ channelId }: ChannelSelectEvent) {
            if (!channelId) return;
            if (channelId === lastSelectedChannelId) return;

            lastSelectedChannelId = channelId;
            const pruningEnabled = settings.store.enableChannelCachePruning;
            if (!pruningEnabled) {
                if (wasPruningEnabled) clearRuntimeState();
                return;
            }
            wasPruningEnabled = true;

            clearPendingPrune(channelId);
            warmPrunedChannels.delete(channelId);
            enqueueVisited(channelId);
            schedulePruneCheck();
        }
    },

    stop() {
        clearRuntimeState();
    }
});
