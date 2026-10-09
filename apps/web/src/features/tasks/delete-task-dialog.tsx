'use client';

import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { useT } from '@/i18n/locale-provider';
import { isApiError } from '@/lib/api-errors';
import type { Task } from '@/lib/dto';
import { notifyWriteError } from '@/lib/notify';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';

import { deleteTask } from './tasks-api';

/** Confirms and deletes `task`; open while a task is given. */
export function DeleteTaskDialog({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const t = useT();
  return (
    <ConfirmDialog
      open={task !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t.tasks.remove.title}
      description={task ? t.tasks.remove.description(task.title) : ''}
      confirmLabel={t.tasks.remove.confirm}
      onConfirm={async () => {
        if (!task) return;
        try {
          await deleteTask(task.workspaceId, task.teamId, task.id);
          toast.success(t.tasks.remove.deleted);
        } catch (error) {
          // Someone else deleted it first: the goal is reached, so this is not reported as a failure.
          if (isApiError(error) && error.status === 404) toast.info(t.tasks.remove.alreadyDeleted);
          else notifyWriteError(error);
        } finally {
          invalidationBus.publish(topics.tasks(task.teamId));
        }
      }}
    />
  );
}
