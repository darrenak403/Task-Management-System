import { messages } from '@/i18n/messages';
import type { PlanDraftItem } from '@/lib/dto';

import type { FieldLock } from './ai-plans-api';

type Linked = Pick<PlanDraftItem, 'id' | 'dependencies'>;

/** True when `candidateId` already depends on `itemId`, directly or through other items. */
export function dependsOn(items: readonly Linked[], candidateId: string, itemId: string): boolean {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const stack = [candidateId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === itemId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(byId.get(current)?.dependencies ?? []));
  }
  return false;
}

/** Items that `itemId` may depend on without creating a loop. */
export function dependencyCandidates<T extends Linked>(items: readonly T[], itemId: string): T[] {
  return items.filter((item) => item.id !== itemId && !dependsOn(items, item.id, itemId));
}

/** Selected items whose prerequisites are not all selected; such a selection cannot be confirmed. */
export function itemsMissingDependencies<T extends Linked>(items: readonly T[], selectedIds: ReadonlySet<string>): T[] {
  return items.filter((item) => selectedIds.has(item.id) && item.dependencies.some((id) => !selectedIds.has(id)));
}

const LOCKABLE = [
  'title',
  'description',
  'completionCriteria',
  'priority',
  'priorityReason',
  'estimateMinMinutes',
  'estimateMaxMinutes',
  'schedule',
  'checklist',
  'suggestedRole',
  'assigneeId',
] as const satisfies readonly FieldLock['field'][];

/**
 * A field the user edited by hand is locked, so a later AI revision does not overwrite it.
 * Returns the existing locks plus one for every lockable field that differs between the two items.
 */
export function locksAfterEdit(locks: readonly FieldLock[], before: PlanDraftItem, after: PlanDraftItem): FieldLock[] {
  const result = [...locks];
  for (const field of LOCKABLE) {
    if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
    if (!result.some((lock) => lock.itemId === after.id && lock.field === field)) result.push({ itemId: after.id, field });
  }
  return result;
}

/** "45 min", "2 h", "1 h 30 min – 3 h"; null when the item has no estimate. */
export function formatEstimate(item: Pick<PlanDraftItem, 'estimateMinMinutes' | 'estimateMaxMinutes'>): string | null {
  const { estimateMinMinutes: min, estimateMaxMinutes: max } = item;
  if (min === null && max === null) return null;
  if (min === null || max === null || min === max) return formatMinutes((min ?? max) as number);
  return `${formatMinutes(min)} – ${formatMinutes(max)}`;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const text = messages().planner.draft;
  if (hours === 0) return text.minutes(rest);
  return rest === 0 ? text.hours(hours) : `${text.hours(hours)} ${text.minutes(rest)}`;
}
