'use client';

import { cn } from 'cn';

import { Badge } from '@/components/ui/badge';
import { useT } from '@/i18n/locale-provider';
import type { TaskPriority, TaskStatus } from '@/lib/dto';

import { formatDateOnly, isOverdue } from './date-only';

const STATUS_CLASSES: Record<TaskStatus, string> = {
  TODO: 'bg-status-todo text-status-todo-foreground',
  IN_PROGRESS: 'bg-status-in-progress text-status-in-progress-foreground',
  DONE: 'bg-status-done text-status-done-foreground',
};

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  LOW: 'bg-priority-low text-priority-low-foreground',
  MEDIUM: 'bg-priority-medium text-priority-medium-foreground',
  HIGH: 'bg-priority-high text-priority-high-foreground',
};

/** Status is always written out; color only reinforces it. */
export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const t = useT();
  return <Badge className={cn('border-transparent', STATUS_CLASSES[status], className)}>{t.common.status[status]}</Badge>;
}

export function PriorityBadge({ priority, className }: { priority: TaskPriority; className?: string }) {
  const t = useT();
  return (
    <Badge className={cn('border-transparent', PRIORITY_CLASSES[priority], className)}>
      <span className="sr-only">{t.tasks.priorityPrefix} </span>
      {t.common.priority[priority]}
    </Badge>
  );
}

/** Deadline text with a written "Overdue" marker for unfinished tasks past their date. */
export function DueDate({ task, today }: { task: { dueDate: string | null; status: TaskStatus }; today?: string }) {
  const t = useT();
  if (!task.dueDate) return <span className="text-muted-foreground">{t.tasks.noDeadline}</span>;
  const overdue = isOverdue(task, today);
  return (
    <span className={cn('whitespace-nowrap', overdue && 'font-medium text-overdue')}>
      <time dateTime={task.dueDate}>{formatDateOnly(task.dueDate)}</time>
      {overdue ? ` · ${t.tasks.overdue}` : null}
    </span>
  );
}

/** Says how many tasks must be finished first; renders nothing for a task without prerequisites. */
export function DependencyCount({ task }: { task: { dependencies: { prerequisites: string[] } } }) {
  const t = useT();
  const count = task.dependencies.prerequisites.length;
  if (count === 0) return null;
  return (
    <span className="whitespace-nowrap text-muted-foreground">
      {t.tasks.dependsOnCount(count)}
    </span>
  );
}
