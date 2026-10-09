'use client';

import { MoreHorizontalIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/i18n/locale-provider';
import { TASK_STATUSES, type Task, type TaskStatus } from '@/lib/dto';


/** Card menu: changes status without dragging (keyboard, touch, screen readers), plus edit and delete. */
export function StatusMenu({
  task,
  disabled,
  onMove,
  onEdit,
  onDelete,
}: {
  task: Task;
  disabled: boolean;
  onMove: (to: TaskStatus) => void;
  onEdit: () => void;
  /** Omitted when the user may not delete this task. */
  onDelete?: (() => void) | undefined;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" disabled={disabled} aria-label={t.tasks.actionsFor(task.title)}>
          <MoreHorizontalIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t.tasks.board.moveTo}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={task.status} onValueChange={(value) => onMove(value as TaskStatus)}>
          {TASK_STATUSES.map((status) => (
            <DropdownMenuRadioItem key={status} value={status}>
              {t.common.status[status]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onEdit}>{t.common.edit}</DropdownMenuItem>
        {onDelete ? (
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            {t.common.delete}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
