'use client';

import { PlusIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTeam } from '@/features/teams/team-gate';
import { useTeamRoster } from '@/features/teams/use-team-roster';
import { useWorkspace } from '@/features/workspaces/workspace-scope';
import { useT } from '@/i18n/locale-provider';
import { messages } from '@/i18n/messages';
import type { Task, TaskStatus } from '@/lib/dto';
import { displayNameOf } from '@/lib/people';

import { TaskDialog } from './task-dialog';
import { TaskFilters } from './task-filters';
import { TaskListView } from './task-list-view';
import type { TaskView } from './task-query';
import { useTaskQuery } from './use-task-query';

// Loaded on demand so the list view does not ship the drag-and-drop library.
const TaskBoard = dynamic(() => import('./board/task-board').then((module) => module.TaskBoard), {
  ssr: false,
  loading: () => (
    <div className="grid gap-4 md:grid-cols-3" aria-busy="true" aria-label={messages().tasks.board.loading}>
      <Skeleton className="h-64" />
      <Skeleton className="h-64" />
      <Skeleton className="h-64" />
    </div>
  ),
});

export function TeamTasksPage() {
  const t = useT();
  const team = useTeam();
  const { workspaceId } = useWorkspace();
  const { query, setQuery } = useTaskQuery();
  const roster = useTeamRoster(workspaceId, team.id);
  // `null` = closed; otherwise the status preselected in the new-task form.
  const [creating, setCreating] = useState<TaskStatus | null>(null);

  const assigneeName = useCallback(
    (task: Task) => {
      if (!task.assigneeId) return t.tasks.unassigned;
      const member = roster.items.find((person) => person.id === task.assigneeId);
      return member ? displayNameOf(member) : roster.loading ? '…' : t.tasks.formerMember;
    },
    [roster.items, roster.loading, t],
  );

  return (
    <>
      <PageHeader title={team.name} description={t.tasks.teamPage.description}>
        <Tabs value={query.view} onValueChange={(view) => setQuery({ view: view as TaskView })}>
          <TabsList aria-label={t.tasks.teamPage.view}>
            <TabsTrigger value="list">{t.tasks.teamPage.list}</TabsTrigger>
            <TabsTrigger value="board">{t.tasks.teamPage.board}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button onClick={() => setCreating('TODO')}>
          <PlusIcon aria-hidden="true" /> {t.tasks.newTask}
        </Button>
      </PageHeader>

      <TaskFilters query={query} onChange={setQuery} roster={roster} />

      {query.view === 'board' ? (
        <TaskBoard teamId={team.id} query={query} assigneeName={assigneeName} onCreate={setCreating} />
      ) : (
        <TaskListView
          scope={{ teamId: team.id }}
          query={query}
          onQueryChange={setQuery}
          assigneeName={assigneeName}
          emptyMessage={t.tasks.teamPage.empty}
        />
      )}

      <TaskDialog
        workspaceId={workspaceId}
        teamId={team.id}
        defaultStatus={creating ?? 'TODO'}
        open={creating !== null}
        onOpenChange={(open) => (open ? undefined : setCreating(null))}
      />
    </>
  );
}
