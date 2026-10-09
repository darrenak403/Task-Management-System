import { AiProviderError } from './provider.types.js';
import type { CreatePlanInput, PlanOutput } from './planner.schemas.js';

const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

export function prioritizeAndValidate(output: PlanOutput, strategy: CreatePlanInput['strategy'] = 'BALANCED'): PlanOutput {
  const itemsById = new Map(output.items.map((item) => [item.id, item]));
  if (itemsById.size !== output.items.length) throw new AiProviderError('AI_OUTPUT_INVALID');

  const indegree = new Map(output.items.map((item) => [item.id, 0]));
  const dependents = new Map(output.items.map((item) => [item.id, [] as string[]]));
  for (const item of output.items) {
    if (new Set(item.dependencies).size !== item.dependencies.length) throw new AiProviderError('AI_OUTPUT_INVALID');
    for (const prerequisite of item.dependencies) {
      if (prerequisite === item.id || !itemsById.has(prerequisite)) throw new AiProviderError('AI_OUTPUT_INVALID');
      indegree.set(item.id, (indegree.get(item.id) ?? 0) + 1);
      dependents.get(prerequisite)?.push(item.id);
    }
  }

  const originalPosition = new Map(output.items.map((item, index) => [item.id, index]));
  const ready = output.items.filter((item) => indegree.get(item.id) === 0);
  const sorted = [] as PlanOutput['items'];
  while (ready.length > 0) {
    ready.sort((left, right) => compareStrategy(left, right, strategy, originalPosition));
    const item = ready.shift();
    if (!item) break;
    sorted.push(item);
    for (const dependent of dependents.get(item.id) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        const next = itemsById.get(dependent);
        if (next) ready.push(next);
      }
    }
  }
  if (sorted.length !== output.items.length) throw new AiProviderError('AI_OUTPUT_INVALID');
  return { ...output, items: sorted };
}

function compareStrategy(
  left: PlanOutput['items'][number],
  right: PlanOutput['items'][number],
  strategy: CreatePlanInput['strategy'],
  originalPosition: Map<string, number>,
): number {
  const priority = priorityOrder[left.priority] - priorityOrder[right.priority];
  const estimate = (left.estimateMaxMinutes ?? Number.MAX_SAFE_INTEGER) - (right.estimateMaxMinutes ?? Number.MAX_SAFE_INTEGER);
  if (strategy === 'FASTEST') return estimate || priority || (originalPosition.get(left.id) ?? 0) - (originalPosition.get(right.id) ?? 0);
  if (strategy === 'QUALITY_FIRST') return priority || (originalPosition.get(left.id) ?? 0) - (originalPosition.get(right.id) ?? 0);
  return priority || estimate || (originalPosition.get(left.id) ?? 0) - (originalPosition.get(right.id) ?? 0);
}

export function planTimeline(input: CreatePlanInput, source: PlanOutput): PlanOutput {
  const warnings = [...source.warnings];
  const items = source.items.map((item) => {
    if (item.schedule.mode === 'RELATIVE') {
      const knownDuration = input.durationDays ?? (input.startDate && input.targetDate ? dateDifference(input.startDate, input.targetDate) + 1 : null);
      if (knownDuration === null || [item.schedule.startDay, item.schedule.dueDay]
        .some((day) => day !== null && day > knownDuration)) {
        warnings.push(`Timeline for "${item.title}" is unspecified because no matching duration was provided.`);
        return { ...item, schedule: { mode: 'NONE' as const } };
      }
      return item;
    }
    if (item.schedule.mode === 'ABSOLUTE') {
      const dates = [item.schedule.startDate, item.schedule.dueDate].filter((date): date is string => date !== null);
      const withinKnownRange = dates.every((date) =>
        (!input.startDate || date >= input.startDate) && (!input.targetDate || date <= input.targetDate));
      const anchored = input.startDate !== null;
      if (!anchored || !withinKnownRange) {
        warnings.push(`Calendar dates for "${item.title}" were omitted because a start date was not supplied or the dates exceed the selected range.`);
        return { ...item, schedule: { mode: 'NONE' as const } };
      }
    }
    return item;
  });

  if (!input.startDate && !input.targetDate && !input.durationDays) {
    warnings.push('No date anchor or duration was supplied; the plan keeps schedule dates unspecified.');
  }
  if (items.some((item) => item.estimateMinMinutes === null)) {
    warnings.push('Some estimates are unknown and need team review.');
  }
  if (!input.includeMembers || input.memberIds.length === 0) {
    warnings.push('No team capacity or assignment data was supplied; assignees and workload remain unknown.');
  }

  return { ...source, warnings: [...new Set(warnings)].slice(0, 20), items };
}

function dateDifference(start: string, end: string): number {
  const startTime = new Date(`${start}T00:00:00.000Z`).getTime();
  const endTime = new Date(`${end}T00:00:00.000Z`).getTime();
  return Math.floor((endTime - startTime) / 86_400_000);
}
