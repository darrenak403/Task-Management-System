'use client';

import { GripVerticalIcon } from 'lucide-react';

import { KanbanItem } from '@/components/ui/kanban';
import type { Task, TaskStatus } from '@/lib/dto';

import { DependencyCount, DueDate, PriorityBadge } from '../task-badges';
import { StatusMenu } from './status-menu';

export function TaskCardBody({ task, assigneeName, today }: { task: Task; assigneeName: string; today: string }) {
  return (
    <>
      <p className="text-sm leading-snug font-medium break-words">{task.title}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <PriorityBadge priority={task.priority} />
        <DueDate task={task} today={today} />
        <DependencyCount task={task} />
      </div>
      <p className="truncate text-xs text-muted-foreground">{assigneeName}</p>
    </>
  );
}

/** A board card that can be dragged from anywhere on it. A click without movement still opens the task or its menu. */
export function TaskCard({
  task,
  assigneeName,
  today,
  saving,
  onMove,
  onEdit,
  onDelete,
}: {
  task: Task;
  assigneeName: string;
  today: string;
  /** The card's status change is being saved; it cannot be moved again until that settles. */
  saving: boolean;
  onMove: (to: TaskStatus) => void;
  onEdit: () => void;
  onDelete?: (() => void) | undefined;
}) {
  return (
    // `touch-manipulation` keeps swipe scrolling on touch screens; a short press starts the drag there.
    <KanbanItem
      value={task.id}
      asHandle
      disabled={saving}
      aria-busy={saving}
      className="touch-manipulation rounded-lg border bg-card shadow-xs transition-shadow hover:shadow-sm"
    >
      {/* Decoration lives on this inner element; the outer one is transformed by the drag library. */}
      <div className="flex items-start gap-1 p-2 transition-opacity data-[saving=true]:opacity-60" data-saving={saving}>
        <GripVerticalIcon className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <button
          type="button"
          onClick={onEdit}
          className="flex min-w-0 flex-1 cursor-grab flex-col gap-1.5 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <TaskCardBody task={task} assigneeName={assigneeName} today={today} />
        </button>
        <StatusMenu task={task} disabled={saving} onMove={onMove} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </KanbanItem>
  );
}
