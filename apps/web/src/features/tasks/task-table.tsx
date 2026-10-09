'use client';

import { MoreHorizontalIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { canDeleteTask } from '@/features/workspaces/permissions';
import { useT } from '@/i18n/locale-provider';
import type { Task, WorkspaceRole } from '@/lib/dto';

import { todayDateOnly } from './date-only';
import { DependencyCount, DueDate, PriorityBadge, StatusBadge } from './task-badges';

export function TaskTable({
  tasks,
  loading,
  busy,
  actor,
  assigneeName,
  teamName,
  onEdit,
  onDelete,
}: {
  tasks: Task[];
  loading: boolean;
  /** A background refetch is running; rows stay visible. */
  busy: boolean;
  actor: { id: string; role: WorkspaceRole | undefined };
  assigneeName: (task: Task) => string;
  /** When given, a Team column is shown (lists that span several teams). */
  teamName?: (task: Task) => string;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const t = useT();
  const today = todayDateOnly();
  const columns = teamName ? 7 : 6;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table aria-busy={loading || busy}>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">{t.tasks.fields.title}</TableHead>
            {teamName ? <TableHead>{t.tasks.fields.team}</TableHead> : null}
            <TableHead>{t.tasks.fields.status}</TableHead>
            <TableHead>{t.tasks.fields.priority}</TableHead>
            <TableHead>{t.tasks.fields.deadline}</TableHead>
            <TableHead>{t.tasks.fields.assignee}</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">{t.common.actions}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? [0, 1, 2, 3].map((row) => (
                <TableRow key={row}>
                  <TableCell colSpan={columns}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            : tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="max-w-md">
                    <button
                      type="button"
                      onClick={() => onEdit(task)}
                      className="block max-w-full truncate rounded-sm text-left font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {task.title}
                    </button>
                    <span className="block text-xs">
                      <DependencyCount task={task} />
                    </span>
                  </TableCell>
                  {teamName ? <TableCell className="text-muted-foreground">{teamName(task)}</TableCell> : null}
                  <TableCell>
                    <StatusBadge status={task.status} />
                  </TableCell>
                  <TableCell>
                    <PriorityBadge priority={task.priority} />
                  </TableCell>
                  <TableCell>
                    <DueDate task={task} today={today} />
                  </TableCell>
                  <TableCell className={task.assigneeId ? undefined : 'text-muted-foreground'}>{assigneeName(task)}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={t.tasks.actionsFor(task.title)}>
                          <MoreHorizontalIcon aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onEdit(task)}>{t.common.edit}</DropdownMenuItem>
                        {canDeleteTask(actor, task) ? (
                          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(task)}>
                            {t.common.delete}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  );
}
