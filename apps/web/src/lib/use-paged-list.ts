'use client';

import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { isAccessLost } from './api-errors';
import type { Page } from './dto';
import { invalidationBus } from './realtime/invalidation-bus';

export type PagedList<T> = {
  items: T[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: unknown;
  loadMore: () => void;
  /** Refetches every page loaded so far; resolves to whether fresh data arrived. */
  reload: () => Promise<boolean>;
};

const NO_ITEMS: never[] = [];

/**
 * Accumulating "load more" list over a paginated endpoint (board columns, rosters, switchers).
 * The key carries user, scope and query; each key has its own cached pages, and leaving a key
 * aborts its request. A `null` key disables loading.
 */
export function usePagedList<T extends { id: string }>(
  key: string | null,
  fetchPage: (page: number, signal: AbortSignal) => Promise<Page<T>>,
  options: { topics?: readonly string[] } = {},
): PagedList<T> {
  const query = useInfiniteQuery<Page<T>, unknown, InfiniteData<Page<T>, number>, readonly unknown[], number>({
    queryKey: ['paged', key],
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
    enabled: key !== null,
  });
  const { refetch, fetchNextPage, hasNextPage, isFetching } = query;

  const reload = useCallback(async () => {
    if (key === null) return false;
    const result = await refetch();
    return result.isSuccess && !result.isError;
  }, [key, refetch]);

  const loadMore = useCallback(() => {
    if (key !== null && hasNextPage && !isFetching) void fetchNextPage();
  }, [key, hasNextPage, isFetching, fetchNextPage]);

  const topicKey = (options.topics ?? []).join('|');
  useEffect(() => {
    if (key === null || topicKey === '') return;
    return invalidationBus.subscribe(topicKey.split('|'), reload);
  }, [key, topicKey, reload]);

  const error = query.error ?? undefined;
  // Loaded rows stay visible on a failed reload, unless access to them is gone.
  const pages = key === null || isAccessLost(error) ? undefined : query.data?.pages;
  const items = useMemo(() => {
    if (!pages) return NO_ITEMS as T[];
    // A row can shift between pages when data changes mid-pagination; never show it twice.
    const seen = new Set<string>();
    return pages.flatMap((page) => page.data).filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
  }, [pages]);

  return {
    items,
    total: pages?.at(-1)?.meta.total ?? 0,
    hasMore: pages !== undefined && hasNextPage,
    loading: key !== null && query.isPending,
    loadingMore: query.isFetchingNextPage,
    error: key === null ? undefined : error,
    loadMore,
    reload,
  };
}
