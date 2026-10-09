'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { TextField } from '@/components/text-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useTeamRoster } from '@/features/teams/use-team-roster';
import { useT } from '@/i18n/locale-provider';
import { msg } from '@/i18n/messages';
import { errorMessage, fieldErrors, isAccessLost, isApiError, isOutcomeUnknown } from '@/lib/api-errors';
import { TASK_PRIORITIES, TASK_STATUSES, type Task, type TaskPriority, type TaskStatus, type UpdateTaskInput } from '@/lib/dto';
import { validate, type FieldErrors } from '@/lib/form';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';

import { AssigneeSelect } from './assignee-select';
import { DeadlinePicker } from './deadline-picker';
import { TaskDependencies } from './task-dependencies';
import { createTask, updateTask } from './tasks-api';

const schema = z.object({
  title: z.string().trim().min(1, msg((m) => m.tasks.dialog.titleRequired)).max(200, msg((m) => m.tasks.dialog.titleTooLong)),
  description: z.string().max(5000, msg((m) => m.tasks.dialog.descriptionTooLong)),
});

type Props = {
  workspaceId: string;
  teamId: string;
  /** The task to edit; omit to create one. */
  task?: Task | null;
  /** The newest copy of `task` the screen holds. When it is newer than `task`, the form offers to reload. */
  latest?: Task | undefined;
  onReload?: (latest: Task) => void;
  /** Status preselected for a new task, e.g. the board column it was opened from. */
  defaultStatus?: TaskStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TaskDialog({ open, onOpenChange, ...rest }: Props) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {/* The form mounts with the dialog, so every opening starts from the task's current values. */}
        {open ? (
          // Keyed by version: reloading a task that changed elsewhere restarts the form from the new values.
          <TaskForm key={rest.task?.updatedAt ?? 'new'} {...rest} pending={pending} setPending={setPending} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  workspaceId,
  teamId,
  task,
  latest,
  onReload,
  defaultStatus = 'TODO',
  pending,
  setPending,
  onClose,
}: Omit<Props, 'open' | 'onOpenChange'> & { pending: boolean; setPending: (pending: boolean) => void; onClose: () => void }) {
  const t = useT();
  const roster = useTeamRoster(workspaceId, teamId);
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? defaultStatus);
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'MEDIUM');
  const [assigneeId, setAssigneeId] = useState<string | null>(task?.assigneeId ?? null);
  const [dueDate, setDueDate] = useState<string | null>(task?.dueDate ?? null);
  // Saving dependencies gives the task a new version that is this dialog's own, not someone else's change.
  const [knownUpdatedAt, setKnownUpdatedAt] = useState(task?.updatedAt);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = validate(schema, { title: form.get('title'), description: form.get('description') ?? '' });
    setFormError(null);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    const values = { ...result.data, status, priority, assigneeId, dueDate };

    setPending(true);
    try {
      if (task) {
        const changes = changedFields(task, values);
        if (Object.keys(changes).length > 0) await updateTask(workspaceId, teamId, task.id, changes);
      } else {
        await createTask(workspaceId, teamId, values);
      }
      invalidationBus.publish(topics.tasks(teamId));
      toast.success(task ? t.tasks.dialog.saved : t.tasks.dialog.created);
      setPending(false);
      onClose();
    } catch (error) {
      setPending(false);
      // Whatever went wrong, the list may now differ from what the server holds.
      invalidationBus.publish(topics.tasks(teamId));
      if (isOutcomeUnknown(error)) {
        setFormError(t.tasks.dialog.outcomeUnknown);
        return;
      }
      if (isApiError(error) && error.code === 'INVALID_TEAM_MEMBER') {
        invalidationBus.publish(topics.roster(teamId));
        setErrors({ assigneeId: t.tasks.dialog.assigneeGone });
        return;
      }
      if (isAccessLost(error)) invalidationBus.publish(topics.structure);
      const serverFields = fieldErrors(error);
      if (Object.keys(serverFields).length > 0) setErrors(serverFields);
      else setFormError(errorMessage(error));
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{task ? t.tasks.dialog.editTitle : t.tasks.dialog.newTitle}</DialogTitle>
        <DialogDescription>{task ? t.tasks.dialog.editDescription : t.tasks.dialog.newDescription}</DialogDescription>
      </DialogHeader>

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      {/* What is being typed is never replaced by a remote change; the user decides when to reload. */}
      {task && latest && latest.updatedAt !== task.updatedAt && latest.updatedAt !== knownUpdatedAt ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {t.tasks.dialog.updatedElsewhere}
            <Button type="button" variant="outline" size="sm" onClick={() => onReload?.(latest)} disabled={pending}>
              {t.common.reload}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <TextField id="title" label={t.tasks.fields.title} defaultValue={task?.title ?? ''} maxLength={200} autoFocus error={errors.title} />

      <Field data-invalid={errors.description ? true : undefined}>
        <FieldLabel htmlFor="description">{t.tasks.fields.description}</FieldLabel>
        <Textarea
          id="description"
          name="description"
          defaultValue={task?.description ?? ''}
          maxLength={5000}
          rows={4}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? 'description-error' : undefined}
        />
        {errors.description ? <FieldError id="description-error">{errors.description}</FieldError> : null}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="status">{t.tasks.fields.status}</FieldLabel>
          <Select value={status} onValueChange={(value) => setStatus(value as TaskStatus)}>
            <SelectTrigger id="status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t.common.status[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="priority">{t.tasks.fields.priority}</FieldLabel>
          <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
            <SelectTrigger id="priority" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_PRIORITIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t.common.priority[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field data-invalid={errors.assigneeId ? true : undefined}>
          <FieldLabel htmlFor="assigneeId">{t.tasks.fields.assignee}</FieldLabel>
          <AssigneeSelect
            id="assigneeId"
            roster={roster}
            value={assigneeId}
            onChange={setAssigneeId}
            emptyLabel={t.tasks.unassigned}
            invalid={Boolean(errors.assigneeId)}
          />
          {errors.assigneeId ? <FieldError>{errors.assigneeId}</FieldError> : null}
        </Field>

        <Field data-invalid={errors.dueDate ? true : undefined}>
          <FieldLabel htmlFor="dueDate">{t.tasks.fields.deadline}</FieldLabel>
          <DeadlinePicker id="dueDate" value={dueDate} onChange={setDueDate} />
          {errors.dueDate ? <FieldError>{errors.dueDate}</FieldError> : null}
        </Field>
      </div>

      {task && knownUpdatedAt ? (
        <Field aria-labelledby="task-dependencies-label">
          <FieldLabel id="task-dependencies-label">{t.tasks.fields.dependsOn}</FieldLabel>
          <TaskDependencies workspaceId={workspaceId} teamId={teamId} task={task} updatedAt={knownUpdatedAt} onSaved={setKnownUpdatedAt} disabled={pending} />
        </Field>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : task ? t.tasks.dialog.saveChanges : t.tasks.dialog.create}
        </Button>
      </DialogFooter>
    </form>
  );
}

type Editable = Required<Pick<UpdateTaskInput, 'title' | 'description' | 'status' | 'priority' | 'assigneeId' | 'dueDate'>>;

/** Only edited fields are sent, so a save never overwrites a field someone else changed meanwhile. */
function changedFields(task: Task, values: Editable): UpdateTaskInput {
  const changes: UpdateTaskInput = {};
  if (values.title !== task.title) changes.title = values.title;
  if (values.description !== task.description) changes.description = values.description;
  if (values.status !== task.status) changes.status = values.status;
  if (values.priority !== task.priority) changes.priority = values.priority;
  if (values.assigneeId !== task.assigneeId) changes.assigneeId = values.assigneeId;
  if (values.dueDate !== task.dueDate) changes.dueDate = values.dueDate;
  return changes;
}
