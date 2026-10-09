import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createQueryClient } from '@/components/query-provider';

import { ApiError } from './api-errors';
import { useResource } from './use-resource';

type Deferred = { resolve: (value: string) => void; reject: (error: unknown) => void; signal: AbortSignal };

/** A loader whose responses are settled by the test, in any order. */
function controlledLoader() {
  const calls = new Map<string, Deferred[]>();
  const loaderFor = (key: string) => (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      calls.set(key, [...(calls.get(key) ?? []), { resolve, reject, signal }]);
    });
  const last = (key: string) => calls.get(key)!.at(-1)!;
  return { loaderFor, last };
}

/** A fresh cache per test, unless one is passed to share it between renders. */
function withCache(client: QueryClient = createQueryClient()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(cleanup);

describe('useResource', () => {
  it('never renders a slow response that belongs to the previous key', async () => {
    const { loaderFor, last } = controlledLoader();
    const { result, rerender } = renderHook(({ key }) => useResource(key, loaderFor(key)), {
      initialProps: { key: 'workspace:a' },
      wrapper: withCache(),
    });

    rerender({ key: 'workspace:b' });
    expect(last('workspace:a').signal.aborted).toBe(true);

    await act(async () => {
      last('workspace:b').resolve('B');
      last('workspace:a').resolve('A');
    });

    await waitFor(() => expect(result.current.data).toBe('B'));
  });

  it('hides the previous data as soon as the key changes', async () => {
    const { loaderFor, last } = controlledLoader();
    const { result, rerender } = renderHook(({ key }) => useResource(key, loaderFor(key)), {
      initialProps: { key: 'workspace:a' },
      wrapper: withCache(),
    });
    await act(async () => last('workspace:a').resolve('A'));
    await waitFor(() => expect(result.current.data).toBe('A'));

    rerender({ key: 'workspace:b' });

    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
  });

  it('keeps the last good data when a reload fails', async () => {
    const { loaderFor, last } = controlledLoader();
    const { result } = renderHook(() => useResource('workspace:a', loaderFor('workspace:a')), { wrapper: withCache() });
    await act(async () => last('workspace:a').resolve('A'));
    await waitFor(() => expect(result.current.data).toBe('A'));

    let reloading: Promise<void>;
    act(() => {
      reloading = result.current.reload();
    });
    await act(async () => {
      last('workspace:a').reject(new Error('boom'));
      await reloading;
    });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.data).toBe('A');
    expect(result.current.loading).toBe(false);
  });

  it('does not load while the key is null', () => {
    const { result } = renderHook(() => useResource<string>(null, () => Promise.reject(new Error('must not be called'))), {
      wrapper: withCache(),
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('shows the cached data of a key seen before while it refetches', async () => {
    const { loaderFor, last } = controlledLoader();
    const { result, rerender } = renderHook(({ key }) => useResource(key, loaderFor(key)), {
      initialProps: { key: 'workspace:a' },
      wrapper: withCache(),
    });
    await act(async () => last('workspace:a').resolve('A'));
    await waitFor(() => expect(result.current.data).toBe('A'));
    rerender({ key: 'workspace:b' });
    await act(async () => last('workspace:b').resolve('B'));
    await waitFor(() => expect(result.current.data).toBe('B'));

    rerender({ key: 'workspace:a' });

    expect(result.current.data).toBe('A');
    expect(result.current.loading).toBe(false);
    expect(result.current.fetching).toBe(true);
  });

  it('drops the data when the reload says access is gone', async () => {
    const { loaderFor, last } = controlledLoader();
    const { result } = renderHook(() => useResource('workspace:a', loaderFor('workspace:a')), { wrapper: withCache() });
    await act(async () => last('workspace:a').resolve('A'));
    await waitFor(() => expect(result.current.data).toBe('A'));

    let reloading: Promise<void>;
    act(() => {
      reloading = result.current.reload();
    });
    await act(async () => {
      last('workspace:a').reject(new ApiError({ status: 404, code: 'RESOURCE_NOT_FOUND', message: 'gone' }));
      await reloading;
    });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
    expect(result.current.data).toBeUndefined();
  });
});
