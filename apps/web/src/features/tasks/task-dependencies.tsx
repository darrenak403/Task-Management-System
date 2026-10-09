'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldError } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { useT } from '@/i18n/locale-provider';
import { errorMessage, isOutcomeUnknown } from '@/lib/api-errors';
import type { Task } from '@/lib/dto';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';
import { usePagedList } from '@/lib/use-paged-list';

import { replaceTaskDependencies } from './dependencies-api';
import { listTasks } from './tasks-api';

const OPTIONS_PAGE_SIZE = 100;

/**
 * Chooses which tasks of the same team must be finished before this one. It saves on its own,
 * separately from the task form, and reports the task's new version through `onSaved`.
 */
export function TaskDependencies({
  workspaceId,
  teamId,
  task,
  updatedAt,
  onSaved,
  disabled = false,
}: {
  workspaceId: string;
  teamId: string;
  task: Task;
  /** The newest version of the task this dialog knows, including its own dependency saves. */
  updatedAt: string;
  onSaved: (updatedAt: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const user = useCurrentUser();
  const [saved, setSaved] = useState<string[]>(task.dependencies.prerequisites);
  const [selected, setSelected] = useState<string[]>(task.dependencies.prerequisites);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (page: number, signal: AbortSignal) => listTasks(workspaceId, { teamId, page, pageSize: OPTIONS_PAGE_SIZE }, signal),
    [workspaceId, teamId],
  );
  const options = usePagedList(`task-options:${user.id}:${workspaceId}:${teamId}`, load, { topics: [topics.tasks(teamId)] });

  const candidates = options.items.filter((candidate) => candidate.id !== task.id);
  // Prerequisites on pages not loaded yet stay selected; they are only not listed.
  const unlisted = selected.filter((id) => !candidates.some((candidate) => candidate.id === id)).length;
  const dirty = selected.length !== saved.length || selected.some((id) => !saved.includes(id));

  async function handleSave() {
    setPending(true);
    setError(null);
    try {
      const result = await replaceTaskDependencies(workspaceId, teamId, task.id, { prerequisiteIds: selected, expectedUpdatedAt: updatedAt });
      setSaved(result.prerequisiteIds);
      setSelected(result.prerequisiteIds);
      onSaved(result.updatedAt);
      toast.success(t.tasks.dependencies.saved);
    } catch (cause) {
      setError(
        isOutcomeUnknown(cause)
          ? t.tasks.dependencies.outcomeUnknown
          : errorMessage(cause),
      );
    } finally {
      setPending(false);
      invalidationBus.publish(topics.tasks(teamId));
    }
  }

  return (
    <div className="grid gap-2">
      {options.loading ? (
        <p className="text-sm text-muted-foreground">{t.tasks.dependencies.loading}</p>
      ) : options.error && candidates.length === 0 ? (
        <p className="text-sm text-destructive">{errorMessage(options.error)}</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.tasks.dependencies.none}</p>
      ) : (
        <ul className="grid max-h-40 gap-2 overflow-y-auto rounded-md border p-3">
          {candidates.map((candidate) => {
            const id = `prerequisite-${candidate.id}`;
            return (
              <li key={candidate.id} className="flex items-start gap-2">
                <Checkbox
                  id={id}
                  checked={selected.includes(candidate.id)}
                  disabled={disabled || pending}
                  className="mt-0.5"
                  onCheckedChange={(next) =>
                    setSelected((previous) => (next === true ? [...previous, candidate.id] : previous.filter((value) => value !== candidate.id)))
                  }
                />
                <Label htmlFor={id} className="font-normal leading-snug">
                  {candidate.title}
                  <span className="text-muted-foreground"> · {t.common.status[candidate.status]}</span>
                </Label>
              </li>
            );
          })}
        </ul>
      )}
      {options.hasMore ? (
        <Button type="button" variant="link" size="sm" className="self-start px-0" onClick={options.loadMore} disabled={options.loadingMore}>
          {options.loadingMore ? t.common.loading : t.tasks.dependencies.loadMore}
        </Button>
      ) : null}
      {unlisted > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t.tasks.dependencies.unlisted(unlisted)}
        </p>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
      {dirty ? (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleSave()} disabled={disabled || pending}>
            {pending ? t.common.saving : t.tasks.dependencies.save}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
