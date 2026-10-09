'use client';

import { useMemo, useRef, useState } from 'react';

import { Kanban, KanbanBoard, KanbanOverlay } from '@/components/ui/kanban';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { canDeleteTask } from '@/features/workspaces/permissions';
import { useWorkspace } from '@/features/workspaces/workspace-scope';
import type { Task, TaskStatus } from '@/lib/dto';

import { todayDateOnly } from '../date-only';
import { DeleteTaskDialog } from '../delete-task-dialog';
import { TaskDialog } from '../task-dialog';
import type { TaskQuery } from '../task-query';
import { BoardColumn } from './board-column';
import { TaskCard, TaskCardBody } from './task-card';
import { useBoardColumns } from './use-board-columns';
import { applyPendingMoves, useStatusMove, type BoardColumns } from './use-status-move';

type Shown = Partial<BoardColumns>;

function columnOf(columns: Shown, taskId: string): TaskStatus | undefined {
  return (Object.keys(columns) as TaskStatus[]).find((status) => columns[status]?.some((task) => task.id === taskId));
}

/** Board view: one column per status. Dragging a card to another column changes only its status. */
export function TaskBoard({
  teamId,
  query,
  assigneeName,
  onCreate,
}: {
  teamId: string;
  query: TaskQuery;
  assigneeName: (task: Task) => string;
  onCreate: (status: TaskStatus) => void;
}) {
  const user = useCurrentUser();
  const { workspaceId, role } = useWorkspace();
  const { lists, visible, refetch } = useBoardColumns(workspaceId, teamId, query);
  const { pending, move } = useStatusMove(workspaceId, teamId, refetch);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const today = todayDateOnly();
  const actor = { id: user.id, role };

  const todo = lists.TODO.items;
  const inProgress = lists.IN_PROGRESS.items;
  const done = lists.DONE.items;
  const shown = useMemo(() => {
    const all = applyPendingMoves({ TODO: todo, IN_PROGRESS: inProgress, DONE: done }, pending);
    // Hidden columns are left out, so nothing can be dropped into them.
    return Object.fromEntries(visible.map((status) => [status, all[status]])) as Shown;
  }, [todo, inProgress, done, pending, visible]);

  // While a card is dragged, the board follows the pointer from this copy; the server data is untouched.
  const [dragColumns, setDragColumns] = useState<Shown | null>(null);
  const dragRef = useRef<Shown | null>(null);
  const setDrag = (next: Shown | null) => {
    dragRef.current = next;
    setDragColumns(next);
  };
  const columns = dragColumns ?? shown;

  function findTask(taskId: string): Task | undefined {
    return Object.values(shown)
      .flat()
      .find((task) => task.id === taskId);
  }

  return (
    <>
      <Kanban<Task>
        value={columns as Record<string, Task[]>}
        getItemValue={(task) => task.id}
        onDragStart={() => setDrag(shown)}
        onValueChange={(next) => {
          const current = dragRef.current;
          if (!current) return;
          // Order inside a column is not stored, so a reorder within one column is ignored.
          const crossed = (Object.keys(current) as TaskStatus[]).some((status) => current[status]?.length !== next[status]?.length);
          if (crossed) setDrag(next as Shown);
        }}
        onDragEnd={(event) => {
          const taskId = String(event.active.id);
          const target = dragRef.current ? columnOf(dragRef.current, taskId) : undefined;
          const task = findTask(taskId);
          setDrag(null);
          if (task && target && target !== task.status) move(task, target);
        }}
        onDragCancel={() => setDrag(null)}
      >
        {/* Columns scroll sideways on narrow screens instead of shrinking below a readable width. */}
        <KanbanBoard className="items-start overflow-x-auto pb-2">
          {visible.map((status) => {
            const tasks = columns[status] ?? [];
            return (
              <BoardColumn key={status} status={status} list={lists[status]} shownCount={tasks.length} onCreate={() => onCreate(status)}>
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    assigneeName={assigneeName(task)}
                    today={today}
                    saving={pending.get(task.id)?.saving === true}
                    onMove={(to) => move(task, to)}
                    onEdit={() => setEditing(task)}
                    onDelete={canDeleteTask(actor, task) ? () => setDeleting(task) : undefined}
                  />
                ))}
              </BoardColumn>
            );
          })}
        </KanbanBoard>
        <KanbanOverlay>
          {({ value }) => {
            const task = findTask(String(value));
            return task ? (
              <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-3 shadow-lg">
                <TaskCardBody task={task} assigneeName={assigneeName(task)} today={today} />
              </div>
            ) : null;
          }}
        </KanbanOverlay>
      </Kanban>

      {editing ? (
        <TaskDialog
          workspaceId={workspaceId}
          teamId={teamId}
          task={editing}
          latest={findTask(editing.id)}
          onReload={setEditing}
          open
          onOpenChange={(open) => (open ? undefined : setEditing(null))}
        />
      ) : null}
      <DeleteTaskDialog task={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}
