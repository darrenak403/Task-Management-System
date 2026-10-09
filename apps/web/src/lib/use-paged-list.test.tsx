import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '@/components/query-provider';

import { ApiError } from './api-errors';
import type { Page } from './dto';
import { usePagedList } from './use-paged-list';

type Row = { id: string };

function page(number: number, totalPages: number, ...ids: string[]): Page<Row> {
  return { data: ids.map((id) => ({ id })), meta: { page: number, pageSize: 2, total: 3, totalPages } };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>;
}

afterEach(cleanup);

describe('usePagedList', () => {
  it('appends the next page and never lists a row twice', async () => {
    // Row "b" moved to page 2 between the two requests.
    const fetchPage = vi.fn(async (number: number) => (number === 1 ? page(1, 2, 'a', 'b') : page(2, 2, 'b', 'c')));
    const { result } = renderHook(() => usePagedList('rows', fetchPage), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.items.map((row) => row.id)).toEqual(['a', 'b', 'c']));
    expect(result.current.hasMore).toBe(false);
    expect(result.current.total).toBe(3);
  });

  it('keeps the loaded rows and reports failure when a reload fails', async () => {
    const fetchPage = vi.fn(async () => page(1, 1, 'a'));
    const { result } = renderHook(() => usePagedList('rows', fetchPage), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    fetchPage.mockRejectedValueOnce(new Error('boom'));
    let fresh: boolean | undefined;
    await act(async () => {
      fresh = await result.current.reload();
    });

    expect(fresh).toBe(false);
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.items.map((row) => row.id)).toEqual(['a']);
  });

  it('drops the loaded rows when a reload says access is gone', async () => {
    const fetchPage = vi.fn(async () => page(1, 2, 'a', 'b'));
    const { result } = renderHook(() => usePagedList('rows', fetchPage), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    fetchPage.mockRejectedValueOnce(new ApiError({ status: 403, code: 'FORBIDDEN', message: 'no access' }));
    await act(async () => {
      await result.current.reload();
    });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
    expect(result.current.items).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.hasMore).toBe(false);
  });

  it('does not load while the key is null', () => {
    const fetchPage = vi.fn(async () => page(1, 1));
    const { result } = renderHook(() => usePagedList<Row>(null, fetchPage), { wrapper });

    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual([]);
  });
});
