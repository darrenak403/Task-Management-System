'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { isAccessLost } from './api-errors';
import { invalidationBus } from './realtime/invalidation-bus';

export type Resource<T> = {
  data: T | undefined;
  error: unknown;
  /** True until the first result for the current key arrives. */
  loading: boolean;
  /** True while any request for the current key is in flight, including background reloads. */
  fetching: boolean;
  /** Refetches the current key and resolves when it settles; previous data stays visible meanwhile. */
  reload: () => Promise<void>;
};

/**
 * Loads one server resource for a key made of user, scope and query.
 * Each key has its own cache entry, so a slow response from an old workspace, team or filter
 * can never be rendered under the new one; a key seen before shows its cached data while it
 * refetches. Leaving a key aborts its request. A `null` key disables loading.
 */
export function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  options: { topics?: readonly string[] } = {},
): Resource<T> {
  const query = useQuery<T, unknown>({
    queryKey: ['resource', key],
    queryFn: ({ signal }) => load(signal),
    enabled: key !== null,
  });
  const { refetch } = query;

  const reload = useCallback(async () => {
    if (key !== null) await refetch();
  }, [key, refetch]);

  const topicKey = (options.topics ?? []).join('|');
  useEffect(() => {
    if (key === null || topicKey === '') return;
    return invalidationBus.subscribe(topicKey.split('|'), reload);
  }, [key, topicKey, reload]);

  const error = query.error ?? undefined;
  return {
    // The last good data stays on a failed background reload, unless access to it is gone.
    data: key === null || isAccessLost(error) ? undefined : query.data,
    error: key === null ? undefined : error,
    loading: key !== null && query.isPending,
    fetching: key !== null && query.isFetching,
    reload,
  };
}
