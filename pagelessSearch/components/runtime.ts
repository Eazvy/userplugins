/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const SCROLL_THRESHOLD_PX = 0;
const DEFAULT_RESULTS_PER_PAGE = 25;
const EDGE_IDLE_MS = 45;
const EDGE_SLOP_PX = 40;
let isLoadingNextPage = false;

export type SearchQuery = {
    offset?: number;
    totalResults?: number;
    total_results?: number;
    limit?: number;
    pageSize?: number;
    searchContextId?: string;
};

export type OnPageChangeHandler = (pageIndex: number) => void;

let lastQuery: SearchQuery | null = null;
let lastOnPageChange: OnPageChangeHandler | null = null;
let lastRequestedPageIndex: number | null = null;
let bottomStage: 0 | 1 = 0;
let lastScrollTop = 0;
let bottomLastEdgeWheelAt = 0;
let topStage: 0 | 1 = 0;
let topLastEdgeWheelAt = 0;

export function captureQuery(query: SearchQuery) {
    lastQuery = query;
}

export function captureOnPageChange(handler: OnPageChangeHandler) {
    lastOnPageChange = handler;
    return handler;
}

export function onSearchResultsScroll(event: React.UIEvent<HTMLElement>) {
    const target = event.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const edgeLimit = EDGE_SLOP_PX - SCROLL_THRESHOLD_PX;
    const atBottom = scrollHeight - scrollTop - clientHeight <= edgeLimit;
    const atTop = scrollTop <= EDGE_SLOP_PX;
    const delta = scrollTop - lastScrollTop;
    lastScrollTop = scrollTop;

    if (atBottom && bottomStage === 0 && delta > 0) {
        bottomStage = 1;
        bottomLastEdgeWheelAt = Date.now();
    } else if (!atBottom || delta < 0) {
        bottomStage = 0;
        bottomLastEdgeWheelAt = 0;
    }

    if (atTop && topStage === 0 && delta < 0) {
        topStage = 1;
        topLastEdgeWheelAt = Date.now();
    } else if (!atTop || delta > 0) {
        topStage = 0;
        topLastEdgeWheelAt = 0;
    }
}

export function onSearchResultsWheel(event: React.WheelEvent<HTMLElement>) {
    const target = event.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const edgeLimit = EDGE_SLOP_PX - SCROLL_THRESHOLD_PX;
    const atBottom = scrollHeight - scrollTop - clientHeight <= edgeLimit;
    const atTop = scrollTop <= EDGE_SLOP_PX;
    const now = event.timeStamp || Date.now();

    if (event.deltaY > 0) {
        if (!atBottom || isLoadingNextPage) {
            if (!atBottom) {
                bottomStage = 0;
                bottomLastEdgeWheelAt = 0;
            }
            return;
        }

        if (bottomStage === 0) {
            bottomStage = 1;
            bottomLastEdgeWheelAt = now;
            return;
        }

        if (bottomLastEdgeWheelAt === 0 || now - bottomLastEdgeWheelAt < EDGE_IDLE_MS) {
            bottomLastEdgeWheelAt = now;
            return;
        }

        bottomStage = 0;
        bottomLastEdgeWheelAt = 0;
        loadNextPage();
        return;
    }

    if (event.deltaY < 0) {
        if (!atTop || isLoadingNextPage) {
            if (!atTop) {
                topStage = 0;
                topLastEdgeWheelAt = 0;
            }
            return;
        }

        if (topStage === 0) {
            topStage = 1;
            topLastEdgeWheelAt = now;
            return;
        }

        if (topLastEdgeWheelAt === 0 || now - topLastEdgeWheelAt < EDGE_IDLE_MS) {
            topLastEdgeWheelAt = now;
            return;
        }

        topStage = 0;
        topLastEdgeWheelAt = 0;
        loadPreviousPage();
    }
}

export function loadNextPage() {
    if (isLoadingNextPage || !lastOnPageChange) return;

    const query = lastQuery;
    if (!query) return;

    const offset = query.offset ?? 0;
    const totalResults = query.totalResults ?? query.total_results ?? 0;
    const limit = query.limit ?? query.pageSize ?? DEFAULT_RESULTS_PER_PAGE;
    if (!Number.isFinite(limit) || limit <= 0) return;
    const nextOffset = offset + limit;

    if (totalResults !== 0 && nextOffset >= totalResults) return;

    isLoadingNextPage = true;

    const nextPageIndex = Math.floor(offset / limit) + 1;
    if (lastRequestedPageIndex === nextPageIndex) {
        isLoadingNextPage = false;
        return;
    }

    lastRequestedPageIndex = nextPageIndex;
    bottomStage = 0;
    bottomLastEdgeWheelAt = 0;
    topStage = 0;
    topLastEdgeWheelAt = 0;
    lastOnPageChange(nextPageIndex);

    setTimeout(() => {
        isLoadingNextPage = false;
    }, 1500);
}

export function loadPreviousPage() {
    if (isLoadingNextPage || !lastOnPageChange) return;

    const query = lastQuery;
    if (!query) return;

    const offset = query.offset ?? 0;
    const limit = query.limit ?? query.pageSize ?? DEFAULT_RESULTS_PER_PAGE;
    if (!Number.isFinite(limit) || limit <= 0) return;
    if (offset <= 0) return;

    isLoadingNextPage = true;

    const prevPageIndex = Math.max(0, Math.floor((offset - limit) / limit));
    if (lastRequestedPageIndex === prevPageIndex) {
        isLoadingNextPage = false;
        return;
    }

    lastRequestedPageIndex = prevPageIndex;
    bottomStage = 0;
    bottomLastEdgeWheelAt = 0;
    topStage = 0;
    topLastEdgeWheelAt = 0;
    lastOnPageChange(prevPageIndex);

    setTimeout(() => {
        isLoadingNextPage = false;
    }, 1500);
}

export function resetState() {
    lastQuery = null;
    lastOnPageChange = null;
    lastRequestedPageIndex = null;
    bottomStage = 0;
    lastScrollTop = 0;
    bottomLastEdgeWheelAt = 0;
    topStage = 0;
    topLastEdgeWheelAt = 0;
    isLoadingNextPage = false;
}
