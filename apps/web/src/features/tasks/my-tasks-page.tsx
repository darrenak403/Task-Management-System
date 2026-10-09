'use client';

import { useCallback } from 'react';

import { PageHeader } from '@/components/page-header';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { useWorkspaceScope } from '@/features/workspaces/workspace-scope';
import { useT } from '@/i18n/locale-provider';
import type { Task } from '@/lib/dto';
import { displayNameOf } from '@/lib/people';

import { TaskFilters } from './task-filters';
import { TaskListView } from './task-list-view';
import { useTaskQuery } from './use-task-query';

/** Tasks assigned to the current user across every team they can see in the workspace. */
export function MyTasksPage() {
  const t = useT();
  const user = useCurrentUser();
  const { teams } = useWorkspaceScope();
  const { query, setQuery } = useTaskQuery();

  const myName = displayNameOf(user);
  const assigneeName = useCallback(() => myName, [myName]);
  const teamName = useCallback(
    (task: Task) => teams.items.find((team) => team.id === task.teamId)?.name ?? '—',
    [teams.items],
  );

  return (
    <>
      <PageHeader title={t.nav.myTasks} description={t.tasks.myTasks.description} />
      <TaskFilters query={query} onChange={setQuery} />
      <TaskListView
        scope={{ assigneeId: user.id }}
        query={query}
        onQueryChange={setQuery}
        assigneeName={assigneeName}
        teamName={teamName}
        emptyMessage={t.tasks.myTasks.empty}
      />
    </>
  );
}
