'use client';

import { useCallback } from 'react';

import { useCurrentUser } from '@/features/auth/auth-provider';
import type { Page, Task } from '@/lib/dto';
import { topics } from '@/lib/realtime/invalidation-bus';
import { useResource, type Resource } from '@/lib/use-resource';

import { listTasks, type TaskListFilter } from './tasks-api';

/**
 * One page of tasks for a workspace scope and filter. The key carries the user, the scope and
 * every filter value, so a response for an earlier filter or workspace is aborted and never shown.
 */
export function useTaskList(workspaceId: string, filter: TaskListFilter): Resource<Page<Task>> {
  const user = useCurrentUser();
  const { teamId, assigneeId, q, status, priority, page } = filter;
  const key = ['tasks', user.id, workspaceId, teamId, assigneeId, q?.trim(), status, priority, page].join('|');

  const load = useCallback(
    (signal: AbortSignal) => listTasks(workspaceId, { teamId, assigneeId, q, status, priority, page }, signal),
    [workspaceId, teamId, assigneeId, q, status, priority, page],
  );
  return useResource(key, load, { topics: [teamId ? topics.tasks(teamId) : topics.anyTasks] });
}
