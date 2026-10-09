'use client';

import { PencilIcon } from 'lucide-react';

import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDateOnly } from '@/features/tasks/date-only';
import { PriorityBadge } from '@/features/tasks/task-badges';
import { useT } from '@/i18n/locale-provider';
import type { Messages } from '@/i18n/messages';
import type { PlanDraftItem } from '@/lib/dto';

import { formatEstimate } from './draft-utils';

function scheduleText(schedule: PlanDraftItem['schedule'], text: Messages['planner']['draft']): string | null {
  if (schedule.mode === 'ABSOLUTE') {
    if (schedule.startDate && schedule.dueDate) return `${formatDateOnly(schedule.startDate)} – ${formatDateOnly(schedule.dueDate)}`;
    if (schedule.dueDate) return text.due(formatDateOnly(schedule.dueDate));
    return schedule.startDate ? text.starts(formatDateOnly(schedule.startDate)) : null;
  }
  if (schedule.mode === 'RELATIVE') {
    if (schedule.startDay !== null && schedule.dueDay !== null) return text.dayRange(schedule.startDay, schedule.dueDay);
    if (schedule.dueDay !== null) return text.dueOnDay(schedule.dueDay);
    return schedule.startDay !== null ? text.startsOnDay(schedule.startDay) : null;
  }
  return null;
}

/**
 * One suggested task of a draft. With `onSelectedChange` it can be picked for confirmation,
 * with `onEdit` it can be changed; without them it is read-only.
 */
export function DraftTaskItem({
  item,
  number,
  selected,
  assigneeName,
  dependencyTitles,
  missingDependency = false,
  disabled = false,
  onSelectedChange,
  onEdit,
}: {
  item: PlanDraftItem;
  number: number;
  selected: boolean;
  assigneeName: string | null;
  dependencyTitles: string[];
  /** The task is selected but something it depends on is not. */
  missingDependency?: boolean;
  disabled?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onEdit?: () => void;
}) {
  const t = useT();
  const facts = [formatEstimate(item), scheduleText(item.schedule, t.planner.draft), assigneeName ?? (item.suggestedRole ? t.planner.draft.suggestedRole(item.suggestedRole) : null)].filter(Boolean);
  const checkboxId = `select-${item.id}`;

  return (
    <li className="flex items-start gap-3 rounded-lg border p-3">
      {onSelectedChange ? (
        <Checkbox
          id={checkboxId}
          checked={selected}
          disabled={disabled}
          className="mt-1"
          aria-label={t.planner.draft.include(item.title)}
          onCheckedChange={(value) => onSelectedChange(value === true)}
        />
      ) : null}
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 font-medium break-words">
            <span className="text-muted-foreground">{number}. </span>
            {item.title}
          </p>
          <div className="flex items-center gap-2">
            <PriorityBadge priority={item.priority} />
            {onEdit ? (
              <Button variant="ghost" size="icon" onClick={onEdit} disabled={disabled} aria-label={t.planner.draft.edit(item.title)}>
                <PencilIcon aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>
        {facts.length > 0 ? <p className="text-sm text-muted-foreground">{facts.join(' · ')}</p> : null}
        {dependencyTitles.length > 0 ? (
          <p className={missingDependency ? 'text-sm font-medium text-destructive' : 'text-sm text-muted-foreground'}>
            {t.planner.draft.dependsOn(dependencyTitles.join(', '))}
            {missingDependency ? t.planner.draft.dependencyMissing : null}
          </p>
        ) : null}
        <Task defaultOpen={false}>
          <TaskTrigger title={t.planner.draft.details} />
          <TaskContent>
            {item.description ? <TaskItem className="whitespace-pre-wrap">{item.description}</TaskItem> : null}
            {item.completionCriteria ? <TaskItem>{t.planner.draft.doneWhen(item.completionCriteria)}</TaskItem> : null}
            {item.priorityReason ? <TaskItem>{t.planner.draft.priorityReason(item.priorityReason)}</TaskItem> : null}
            {item.checklist.length > 0 ? (
              <ul className="list-disc pl-5 text-sm text-muted-foreground">
                {item.checklist.map((step, index) => (
                  <li key={`${index}-${step}`}>{step}</li>
                ))}
              </ul>
            ) : null}
          </TaskContent>
        </Task>
      </div>
    </li>
  );
}
