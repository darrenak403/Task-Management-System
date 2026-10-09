'use client';

import { useCallback, useMemo } from 'react';

import { useCurrentUser } from '@/features/auth/auth-provider';
import { TASK_STATUSES, type Task, type TaskStatus } from '@/lib/dto';
import { topics } from '@/lib/realtime/invalidation-bus';
import { usePagedList, type PagedList } from '@/lib/use-paged-list';

import type { TaskQuery } from '../task-query';
import { listTasks } from '../tasks-api';

const COLUMN_PAGE_SIZE = 20;

export type BoardColumnLists = Record<TaskStatus, PagedList<Task>>;

/**
 * One independently paginated list per status, all sharing the search, priority and assignee filters.
 * A status filter narrows the board to that column; the hidden columns are not loaded.
 */
export function useBoardColumns(
  workspaceId: string,
  teamId: string,
  query: TaskQuery,
): { lists: BoardColumnLists; visible: TaskStatus[]; refetch: (statuses: TaskStatus[]) => Promise<boolean> } {
  const todo = useColumn(workspaceId, teamId, query, 'TODO');
  const inProgress = useColumn(workspaceId, teamId, query, 'IN_PROGRESS');
  const done = useColumn(workspaceId, teamId, query, 'DONE');

  const lists = useMemo(() => ({ TODO: todo, IN_PROGRESS: inProgress, DONE: done }), [todo, inProgress, done]);
  const visible = useMemo(() => TASK_STATUSES.filter((status) => !query.status || query.status === status), [query.status]);

  const reloadTodo = todo.reload;
  const reloadInProgress = inProgress.reload;
  const reloadDone = done.reload;
  const refetch = useCallback(
    async (statuses: TaskStatus[]) => {
      const reloads = { TODO: reloadTodo, IN_PROGRESS: reloadInProgress, DONE: reloadDone };
      const results = await Promise.all([...new Set(statuses)].map((status) => reloads[status]()));
      return results.every(Boolean);
    },
    [reloadTodo, reloadInProgress, reloadDone],
  );

  return { lists, visible, refetch };
}

function useColumn(workspaceId: string, teamId: string, query: TaskQuery, status: TaskStatus): PagedList<Task> {
  const user = useCurrentUser();
  const { q, priority, assignee } = query;
  const shown = !query.status || query.status === status;
  const load = useCallback(
    (page: number, signal: AbortSignal) =>
      listTasks(workspaceId, { teamId, status, q, priority, assigneeId: assignee, page, pageSize: COLUMN_PAGE_SIZE }, signal),
    [workspaceId, teamId, status, q, priority, assignee],
  );
  const key = shown ? ['board', user.id, workspaceId, teamId, status, q.trim(), priority, assignee].join('|') : null;
  return usePagedList(key, load, { topics: [topics.tasks(teamId)] });
}
