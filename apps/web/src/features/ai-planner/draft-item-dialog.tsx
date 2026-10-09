'use client';

import { useState } from 'react';
import { z } from 'zod';

import { TextField } from '@/components/text-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AssigneeSelect } from '@/features/tasks/assignee-select';
import { DeadlinePicker } from '@/features/tasks/deadline-picker';
import { useT } from '@/i18n/locale-provider';
import { intlLocale, msg, type Messages } from '@/i18n/messages';
import { TASK_PRIORITIES, type PlanDraftItem, type TaskPriority, type TeamMember } from '@/lib/dto';
import { validate, type FieldErrors } from '@/lib/form';
import type { PagedList } from '@/lib/use-paged-list';

import { DependencyEditor } from './dependency-editor';

type Schedule = PlanDraftItem['schedule'];

const optionalInt = (label: (m: Messages) => string, max: number) =>
  z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : Number(value)))
    .refine((value) => value === null || (Number.isInteger(value) && value >= 1 && value <= max), msg((m) => m.planner.item.wholeNumber(label(m), max.toLocaleString(intlLocale()))));

const checklistLines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const schema = z.object({
  title: z.string().trim().min(1, msg((m) => m.tasks.dialog.titleRequired)).max(200, msg((m) => m.tasks.dialog.titleTooLong)),
  description: z.string().max(5000, msg((m) => m.tasks.dialog.descriptionTooLong)),
  completionCriteria: z.string().trim().min(1, msg((m) => m.planner.item.criteriaRequired)).max(2000, msg((m) => m.planner.item.criteriaTooLong)),
  estimateMinMinutes: optionalInt((m) => m.planner.item.minEstimate, 525_600),
  estimateMaxMinutes: optionalInt((m) => m.planner.item.maxEstimate, 525_600),
  startDay: optionalInt((m) => m.planner.item.startDay, 365),
  dueDay: optionalInt((m) => m.planner.item.dueDay, 365),
  checklist: z
    .string()
    .refine((value) => checklistLines(value).length <= 10, msg((m) => m.planner.item.checklistTooMany))
    .refine((value) => checklistLines(value).every((line) => line.length <= 200), msg((m) => m.planner.item.checklistStepTooLong)),
});

type Props = {
  item: PlanDraftItem | null;
  items: readonly PlanDraftItem[];
  roster: PagedList<TeamMember>;
  /** Resolves to an error message when the save failed, so the dialog stays open with the typed values. */
  onSave: (item: PlanDraftItem) => Promise<string | null>;
  onOpenChange: (open: boolean) => void;
};

export function DraftItemDialog({ item, onOpenChange, ...rest }: Props) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={item !== null} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {item ? <ItemForm key={item.id} item={item} {...rest} pending={pending} setPending={setPending} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ItemForm({
  item,
  items,
  roster,
  onSave,
  pending,
  setPending,
  onClose,
}: Omit<Props, 'item' | 'onOpenChange'> & { item: PlanDraftItem; pending: boolean; setPending: (pending: boolean) => void; onClose: () => void }) {
  const t = useT();
  const [priority, setPriority] = useState<TaskPriority>(item.priority);
  const [assigneeId, setAssigneeId] = useState<string | null>(item.assigneeId);
  const [mode, setMode] = useState<Schedule['mode']>(item.schedule.mode);
  const [startDate, setStartDate] = useState<string | null>(item.schedule.mode === 'ABSOLUTE' ? item.schedule.startDate : null);
  const [dueDate, setDueDate] = useState<string | null>(item.schedule.mode === 'ABSOLUTE' ? item.schedule.dueDate : null);
  const [dependencies, setDependencies] = useState<string[]>(item.dependencies);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '');
    const result = validate(schema, {
      title: text('title'),
      description: text('description'),
      completionCriteria: text('completionCriteria'),
      estimateMinMinutes: text('estimateMinMinutes'),
      estimateMaxMinutes: text('estimateMaxMinutes'),
      // The day fields are hidden outside the relative schedule and must not block the save.
      startDay: mode === 'RELATIVE' ? text('startDay') : '',
      dueDay: mode === 'RELATIVE' ? text('dueDay') : '',
      checklist: text('checklist'),
    });
    setFormError(null);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const values = result.data;
    const problems: FieldErrors = {};
    if ((values.estimateMinMinutes === null) !== (values.estimateMaxMinutes === null)) {
      problems[values.estimateMinMinutes === null ? 'estimateMinMinutes' : 'estimateMaxMinutes'] = t.planner.item.estimatesBoth;
    }
    if (values.estimateMinMinutes !== null && values.estimateMaxMinutes !== null && values.estimateMinMinutes > values.estimateMaxMinutes) {
      problems.estimateMaxMinutes = t.planner.item.estimateOrder;
    }
    if (mode === 'RELATIVE' && values.startDay !== null && values.dueDay !== null && values.startDay > values.dueDay) {
      problems.dueDay = t.planner.item.dayOrder;
    }
    if (mode === 'ABSOLUTE' && startDate && dueDate && startDate > dueDate) problems.schedule = t.planner.item.dateOrder;
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    const schedule: Schedule =
      mode === 'ABSOLUTE' ? { mode, startDate, dueDate } : mode === 'RELATIVE' ? { mode, startDay: values.startDay, dueDay: values.dueDay } : { mode };

    setPending(true);
    const failure = await onSave({
      ...item,
      title: values.title,
      description: values.description,
      completionCriteria: values.completionCriteria,
      priority,
      assigneeId,
      estimateMinMinutes: values.estimateMinMinutes,
      estimateMaxMinutes: values.estimateMaxMinutes,
      schedule,
      dependencies,
      checklist: checklistLines(values.checklist),
    });
    setPending(false);
    if (failure) setFormError(failure);
    else onClose();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t.planner.item.title}</DialogTitle>
        <DialogDescription>{t.planner.item.description}</DialogDescription>
      </DialogHeader>

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <TextField id="title" label={t.tasks.fields.title} defaultValue={item.title} maxLength={200} error={errors.title} disabled={pending} />

      <Field data-invalid={errors.description ? true : undefined}>
        <FieldLabel htmlFor="description">{t.tasks.fields.description}</FieldLabel>
        <Textarea
          id="description"
          name="description"
          defaultValue={item.description}
          rows={3}
          maxLength={5000}
          disabled={pending}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? 'description-error' : undefined}
        />
        {errors.description ? <FieldError id="description-error">{errors.description}</FieldError> : null}
      </Field>

      <Field data-invalid={errors.completionCriteria ? true : undefined}>
        <FieldLabel htmlFor="completionCriteria">{t.planner.item.doneWhen}</FieldLabel>
        <Textarea
          id="completionCriteria"
          name="completionCriteria"
          defaultValue={item.completionCriteria}
          rows={2}
          maxLength={2000}
          disabled={pending}
          aria-invalid={errors.completionCriteria ? true : undefined}
          aria-describedby={errors.completionCriteria ? 'completionCriteria-error' : undefined}
        />
        {errors.completionCriteria ? <FieldError id="completionCriteria-error">{errors.completionCriteria}</FieldError> : null}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="priority">{t.tasks.fields.priority}</FieldLabel>
          <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)} disabled={pending}>
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
        <Field>
          <FieldLabel htmlFor="assigneeId">{t.tasks.fields.assignee}</FieldLabel>
          <AssigneeSelect id="assigneeId" roster={roster} value={assigneeId} onChange={setAssigneeId} emptyLabel={t.tasks.unassigned} disabled={pending} />
        </Field>
        <TextField
          id="estimateMinMinutes"
          label={t.planner.item.estimateFrom}
          inputMode="numeric"
          defaultValue={item.estimateMinMinutes ?? ''}
          error={errors.estimateMinMinutes}
          disabled={pending}
        />
        <TextField
          id="estimateMaxMinutes"
          label={t.planner.item.estimateTo}
          inputMode="numeric"
          defaultValue={item.estimateMaxMinutes ?? ''}
          error={errors.estimateMaxMinutes}
          disabled={pending}
        />
      </div>

      <Field data-invalid={errors.schedule ? true : undefined}>
        <FieldLabel htmlFor="scheduleMode">{t.planner.item.scheduleLabel}</FieldLabel>
        <Select value={mode} onValueChange={(value) => setMode(value as Schedule['mode'])} disabled={pending}>
          <SelectTrigger id="scheduleMode" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(t.planner.item.schedule).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.schedule ? <FieldError>{errors.schedule}</FieldError> : null}
      </Field>

      {mode === 'ABSOLUTE' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="startDate">{t.planner.item.startDate}</FieldLabel>
            <DeadlinePicker id="startDate" value={startDate} onChange={setStartDate} disabled={pending} emptyLabel={t.planner.notSet} />
          </Field>
          <Field>
            <FieldLabel htmlFor="dueDate">{t.tasks.fields.deadline}</FieldLabel>
            <DeadlinePicker id="dueDate" value={dueDate} onChange={setDueDate} disabled={pending} />
          </Field>
        </div>
      ) : null}
      {/* Kept mounted so the day offsets survive switching the mode back and forth. */}
      <div className={mode === 'RELATIVE' ? 'grid gap-4 sm:grid-cols-2' : 'hidden'}>
        <TextField
          id="startDay"
          label={t.planner.item.startDay}
          inputMode="numeric"
          defaultValue={item.schedule.mode === 'RELATIVE' ? (item.schedule.startDay ?? '') : ''}
          error={errors.startDay}
          disabled={pending}
        />
        <TextField
          id="dueDay"
          label={t.planner.item.dueDay}
          inputMode="numeric"
          defaultValue={item.schedule.mode === 'RELATIVE' ? (item.schedule.dueDay ?? '') : ''}
          error={errors.dueDay}
          disabled={pending}
        />
      </div>

      <Field data-invalid={errors.checklist ? true : undefined}>
        <FieldLabel htmlFor="checklist">{t.planner.item.checklist}</FieldLabel>
        <Textarea
          id="checklist"
          name="checklist"
          defaultValue={item.checklist.join('\n')}
          rows={3}
          disabled={pending}
          aria-invalid={errors.checklist ? true : undefined}
          aria-describedby={errors.checklist ? 'checklist-error' : 'checklist-hint'}
        />
        <FieldDescription id="checklist-hint">{t.planner.item.checklistHint}</FieldDescription>
        {errors.checklist ? <FieldError id="checklist-error">{errors.checklist}</FieldError> : null}
      </Field>

      <Field aria-labelledby="draft-dependencies-label">
        <FieldLabel id="draft-dependencies-label">{t.tasks.fields.dependsOn}</FieldLabel>
        <DependencyEditor items={items} itemId={item.id} value={dependencies} onChange={setDependencies} disabled={pending} />
      </Field>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.tasks.dialog.saveChanges}
        </Button>
      </DialogFooter>
    </form>
  );
}
