'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import { parseTaskQuery, taskQueryString, type TaskQuery } from './task-query';

/** Task filters read from, and written to, the URL. Callers must sit below a Suspense boundary. */
export function useTaskQuery(): { query: TaskQuery; setQuery: (patch: Partial<TaskQuery>) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseTaskQuery(searchParams), [searchParams]);

  const setQuery = useCallback(
    (patch: Partial<TaskQuery>) => {
      // Replace, not push: typing in the search box must not fill the history with one entry per keystroke.
      router.replace(`${pathname}${taskQueryString(query, patch)}`, { scroll: false });
    },
    [router, pathname, query],
  );

  return { query, setQuery };
}
