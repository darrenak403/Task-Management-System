'use client';

import { useEffect, useState } from 'react';

import { ErrorState } from '@/components/error-state';
import { PageControls } from '@/components/page-controls';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { useWorkspace } from '@/features/workspaces/workspace-scope';
import { useT } from '@/i18n/locale-provider';
import { errorMessage } from '@/lib/api-errors';
import type { Task } from '@/lib/dto';

import { DeleteTaskDialog } from './delete-task-dialog';
import { TaskDialog } from './task-dialog';
import { hasActiveFilters, type TaskQuery } from './task-query';
import { TaskTable } from './task-table';
import { useTaskList } from './use-task-list';

/** Paginated task table for one scope (a team, or one assignee across the workspace) with edit and delete. */
export function TaskListView({
  scope,
  query,
  onQueryChange,
  assigneeName,
  teamName,
  emptyMessage,
}: {
  scope: { teamId?: string; assigneeId?: string };
  query: TaskQuery;
  onQueryChange: (patch: Partial<TaskQuery>) => void;
  assigneeName: (task: Task) => string;
  teamName?: (task: Task) => string;
  /** Shown when the scope has no tasks at all (no filter applied). */
  emptyMessage: string;
}) {
  const t = useT();
  const user = useCurrentUser();
  const { workspaceId, role } = useWorkspace();
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);

  const list = useTaskList(workspaceId, {
    teamId: scope.teamId,
    assigneeId: scope.assigneeId ?? query.assignee,
    q: query.q,
    status: query.status,
    priority: query.priority,
    page: query.page,
  });
  const meta = list.data?.meta;
  const tasks = list.data?.data ?? [];

  // A page past the end (stale link, or the last row of the last page was deleted) moves to the last page.
  const lastPage = meta ? Math.max(1, meta.totalPages) : undefined;
  useEffect(() => {
    if (lastPage !== undefined && query.page > lastPage) onQueryChange({ page: lastPage });
  }, [lastPage, query.page, onQueryChange]);

  if (list.error && !list.data) {
    return <ErrorState message={errorMessage(list.error)} onRetry={() => void list.reload()} />;
  }

  const isEmpty = !list.loading && meta?.total === 0;

  return (
    <div className="flex flex-col gap-4">
      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          {hasActiveFilters(query) ? (
            <>
              <p className="text-sm text-muted-foreground">{t.tasks.filters.noMatch}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onQueryChange({ q: '', status: undefined, priority: undefined, assignee: undefined })}
              >
                {t.tasks.filters.clear}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          )}
        </div>
      ) : (
        <TaskTable
          tasks={tasks}
          loading={list.loading}
          busy={list.fetching}
          actor={{ id: user.id, role }}
          assigneeName={assigneeName}
          teamName={teamName}
          onEdit={setEditing}
          onDelete={setDeleting}
        />
      )}

      {meta ? (
        <PageControls
          page={meta.page}
          totalPages={meta.totalPages}
          total={meta.total}
          onPageChange={(page) => onQueryChange({ page })}
          disabled={list.fetching}
        />
      ) : null}

      {editing ? (
        <TaskDialog
          workspaceId={workspaceId}
          teamId={editing.teamId}
          task={editing}
          latest={tasks.find((task) => task.id === editing.id)}
          onReload={setEditing}
          open
          onOpenChange={(open) => (open ? undefined : setEditing(null))}
        />
      ) : null}
      <DeleteTaskDialog task={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
