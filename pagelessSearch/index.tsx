/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

import { captureOnPageChange, captureQuery, loadNextPage, loadPreviousPage, onSearchResultsScroll, onSearchResultsWheel, resetState } from "./components/runtime";

export default definePlugin({
    name: "PagelessSearch",
    description: "Automatically loads the next page when you scroll to the bottom of search results.",
    authors: [EquicordDevs.omaw],

    patches: [
        {
            find: "renderPageWrapper:W,onBlockedResultsClick:N",
            replacement: {
                match: /onPageChange:(\i),paginationTotalCount:(\i\?\i:void 0)/,
                replace: "onPageChange:$self.captureOnPageChange($1),paginationTotalCount:$2"
            }
        },
        {
            find: "renderPageWrapper:W,onBlockedResultsClick:N,searchRequestAnalyticsId:s,searchResultsQuery:T",
            replacement: {
                match: /searchResultsQuery:(\i),isFavoritesSearch:(\i)\}\)/,
                replace: "searchResultsQuery:($self.captureQuery($1),$1),isFavoritesSearch:$2})"
            }
        },
        {
            find: "renderPageWrapper:W,onBlockedResultsClick:N,searchRequestAnalyticsId:s,searchResultsQuery:T",
            replacement: {
                match: /ref:(\i),className:(\i(?:\.\i)+),children:\[/,
                replace: "ref:$1,className:$2,onScroll:$self.onSearchResultsScroll.bind($self),onWheel:$self.onSearchResultsWheel.bind($self),children:["
            }
        }
    ],

    captureQuery,
    captureOnPageChange,
    onSearchResultsScroll,
    onSearchResultsWheel,
    loadNextPage,
    loadPreviousPage,
    stop: resetState,
});
