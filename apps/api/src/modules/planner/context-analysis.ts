import type { CreatePlanInput, PlanOutput } from './planner.schemas.js';
import type { PersistedCandidate } from './version.schemas.js';

type PlannerMember = {
  id: string; alias: string; capacityMinutesPerDay: number | null; role: string | null; workingDays: number[] | null;
};
type PlannerTask = {
  id: string; title: string; status: string; assigneeId: string | null; estimateMaxMinutes: number | null;
  dueDate: string | null; plannedStartDate: string | null; relativeStartDay: number | null; relativeDueDay: number | null;
};
type PlannerSnapshot = { tasks: PlannerTask[]; members: PlannerMember[] };
type DateWindow = { start: string; end: string };

export function analyzePlanContext(
  input: CreatePlanInput,
  contextValue: unknown,
  output: PlanOutput,
  candidate?: PersistedCandidate,
): { output: PlanOutput; assigneeSuggestions: Map<string, string> } {
  const snapshot = parseSnapshot(contextValue);
  if (!snapshot) return { output, assigneeSuggestions: new Map() };

  const warnings = [...output.warnings];
  const suggestionMap = candidate
    ? new Map(candidate.baseDraft.items.flatMap((item) => item.assigneeId ? [[item.id, item.assigneeId] as const] : []))
    : new Map<string, string>();
  const members = new Map(snapshot.members.map((member) => [member.id, member]));
  const loadByMemberDay = new Map<string, Map<string, number>>();

  for (const task of snapshot.tasks) {
    if (task.status === 'DONE') continue;
    if (!task.assigneeId || !members.has(task.assigneeId)) continue;
    const member = members.get(task.assigneeId);
    if (!member) continue;
    if (!member.capacityMinutesPerDay || !member.workingDays?.length || task.estimateMaxMinutes === null) {
      warnings.push(`Current workload for ${member.alias} is incomplete; capacity cannot be verified for selected task ${task.id}.`);
      continue;
    }
    const window = taskWindow(task, input.startDate);
    if (!window) {
      warnings.push(`Current workload for ${member.alias} has no usable date range for selected task ${task.id}.`);
      continue;
    }
    if (addWorkload(loadByMemberDay, member, window, task.estimateMaxMinutes).length === 0) {
      warnings.push(`No declared working day falls inside the current task window for ${member.alias} on task ${task.id}.`);
    }
  }

  const duplicateWarnings = findDuplicateWarnings(output, snapshot.tasks);
  warnings.push(...duplicateWarnings);
  const idToItem = new Map(output.items.map((item) => [item.id, item]));

  for (const item of output.items) {
    const fixedAssignment = suggestionMap.get(item.id);
    const roleCandidates = item.suggestedRole
      ? snapshot.members.filter((member) => normalize(member.role ?? '') === normalize(item.suggestedRole ?? ''))
      : [];
    const member = fixedAssignment
      ? members.get(fixedAssignment)
      : candidate ? null : selectMember(roleCandidates, item, input.strategy, input.startDate, loadByMemberDay);
    if (!candidate && roleCandidates.length === 1 && member) suggestionMap.set(item.id, member.id);
    if (!member && item.suggestedRole) {
      warnings.push(`Role suggestion "${item.suggestedRole}" for "${item.title}" does not match exactly one selected team member; assignment remains unset.`);
    }
    if (member && !member.capacityMinutesPerDay) {
      warnings.push(`Capacity for ${member.alias} is unknown; workload for "${item.title}" cannot be classified as overloaded.`);
    }
    if (member && item.estimateMaxMinutes === null) {
      warnings.push(`Effort for "${item.title}" is unknown; workload for ${member.alias} cannot be verified.`);
    }
    const window = itemWindow(item.schedule, input.startDate);
    if (member && item.estimateMaxMinutes !== null && window) {
      if (member.capacityMinutesPerDay && member.workingDays?.length) {
        const dailyLoads = addWorkload(loadByMemberDay, member, window, item.estimateMaxMinutes);
        if (dailyLoads.length === 0) warnings.push(`No declared working day falls inside the scheduled window for ${member.alias} on "${item.title}".`);
        for (const [date, minutes] of dailyLoads) {
          if (minutes > member.capacityMinutesPerDay) {
            warnings.push(`${member.alias} has ${minutes} planned minutes on ${date}, above the declared ${member.capacityMinutesPerDay}-minute daily capacity.`);
          }
        }
      }
    } else if (member && item.estimateMaxMinutes !== null) {
      warnings.push(`The timeline for "${item.title}" has no usable date anchor; capacity by day remains unknown.`);
    }

    for (const prerequisiteId of item.dependencies) {
      const prerequisite = idToItem.get(prerequisiteId);
      if (!prerequisite) continue;
      const prerequisiteWindow = itemWindow(prerequisite.schedule, input.startDate);
      const itemDateWindow = itemWindow(item.schedule, input.startDate);
      if (prerequisiteWindow && itemDateWindow && itemDateWindow.start <= prerequisiteWindow.end) {
        warnings.push(`"${item.title}" is scheduled before its prerequisite "${prerequisite.title}" finishes; review the dependency timeline.`);
      }
    }
  }

  return {
    output: { ...output, warnings: [...new Set(warnings)].slice(0, 20) },
    assigneeSuggestions: candidate ? new Map() : suggestionMap,
  };
}

function parseSnapshot(value: unknown): PlannerSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.tasks) || !Array.isArray(value.members)) return null;
  const tasks = value.tasks.filter((task): task is PlannerTask => isRecord(task) &&
    typeof task.id === 'string' && typeof task.title === 'string' && typeof task.status === 'string' &&
    (typeof task.assigneeId === 'string' || task.assigneeId === null) &&
    (typeof task.estimateMaxMinutes === 'number' || task.estimateMaxMinutes === null) &&
    (typeof task.dueDate === 'string' || task.dueDate === null) &&
    (typeof task.plannedStartDate === 'string' || task.plannedStartDate === null) &&
    (typeof task.relativeStartDay === 'number' || task.relativeStartDay === null) &&
    (typeof task.relativeDueDay === 'number' || task.relativeDueDay === null));
  const members = value.members.filter((member): member is PlannerMember => isRecord(member) &&
    typeof member.id === 'string' && typeof member.alias === 'string' &&
    (typeof member.capacityMinutesPerDay === 'number' || member.capacityMinutesPerDay === null) &&
    (typeof member.role === 'string' || member.role === null) &&
    (Array.isArray(member.workingDays) || member.workingDays === null));
  return { tasks, members };
}

function taskWindow(task: PlannerTask, startDate: string | null): DateWindow | null {
  if (task.plannedStartDate || task.dueDate) return { start: task.plannedStartDate ?? task.dueDate ?? '', end: task.dueDate ?? task.plannedStartDate ?? '' };
  if (startDate && (task.relativeStartDay !== null || task.relativeDueDay !== null)) {
    const start = addDate(startDate, (task.relativeStartDay ?? task.relativeDueDay ?? 1) - 1);
    const end = addDate(startDate, (task.relativeDueDay ?? task.relativeStartDay ?? 1) - 1);
    return { start, end };
  }
  return null;
}

function itemWindow(schedule: PlanOutput['items'][number]['schedule'], startDate: string | null): DateWindow | null {
  if (schedule.mode === 'ABSOLUTE') {
    if (!schedule.startDate && !schedule.dueDate) return null;
    return { start: schedule.startDate ?? schedule.dueDate ?? '', end: schedule.dueDate ?? schedule.startDate ?? '' };
  }
  if (schedule.mode === 'RELATIVE' && startDate && (schedule.startDay !== null || schedule.dueDay !== null)) {
    const start = addDate(startDate, (schedule.startDay ?? schedule.dueDay ?? 1) - 1);
    const end = addDate(startDate, (schedule.dueDay ?? schedule.startDay ?? 1) - 1);
    return { start, end };
  }
  return null;
}

function selectMember(
  candidates: PlannerMember[],
  item: PlanOutput['items'][number],
  strategy: CreatePlanInput['strategy'],
  startDate: string | null,
  loads: Map<string, Map<string, number>>,
): PlannerMember | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;
  if (strategy === 'QUALITY_FIRST') return null;
  if (strategy === 'FASTEST') {
    return [...candidates].sort((left, right) => (right.capacityMinutesPerDay ?? 0) - (left.capacityMinutesPerDay ?? 0))[0] ?? null;
  }
  const window = itemWindow(item.schedule, startDate);
  const estimateMaxMinutes = item.estimateMaxMinutes;
  if (!window || estimateMaxMinutes === null) return null;
  const scored = candidates
    .filter((member) => member.capacityMinutesPerDay && member.workingDays?.length)
    .map((member) => {
      const days = workingDates(window, member.workingDays ?? []);
      if (days.length === 0) return { member, peak: Number.POSITIVE_INFINITY };
      const perDay = Math.ceil(estimateMaxMinutes / days.length);
      const current = loads.get(member.id) ?? new Map<string, number>();
      const peak = Math.max(...days.map((date) => (current.get(date) ?? 0) + perDay)) / (member.capacityMinutesPerDay ?? 1);
      return { member, peak };
    })
    .sort((left, right) => left.peak - right.peak);
  if (scored.length === 0 || scored[0]?.peak === Number.POSITIVE_INFINITY) return null;
  return scored[0]?.member ?? null;
}

function addWorkload(
  loads: Map<string, Map<string, number>>,
  member: PlannerMember,
  window: DateWindow,
  estimateMaxMinutes: number,
): Array<[string, number]> {
  const dates = workingDates(window, member.workingDays ?? []);
  if (dates.length === 0) return [];
  const targetDates = dates;
  const perDay = Math.ceil(estimateMaxMinutes / targetDates.length);
  const memberLoads = loads.get(member.id) ?? new Map<string, number>();
  loads.set(member.id, memberLoads);
  return targetDates.map((date) => {
    const total = (memberLoads.get(date) ?? 0) + perDay;
    memberLoads.set(date, total);
    return [date, total];
  });
}

function workingDates(window: DateWindow, workingDays: number[]): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${window.start}T00:00:00.000Z`);
  const end = new Date(`${window.end}T00:00:00.000Z`);
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(end.getTime()) || cursor > end) return dates;
  while (cursor <= end && dates.length < 366) {
    if (workingDays.includes(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function addDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function findDuplicateWarnings(output: PlanOutput, tasks: PlannerTask[]): string[] {
  const warnings: string[] = [];
  for (const item of output.items) {
    const proposed = normalize(item.title);
    const proposedTokens = new Set(proposed.split(' ').filter((token) => token.length > 1));
    for (const task of tasks) {
      if (!task.title) continue;
      const existing = normalize(task.title);
      const existingTokens = new Set(existing.split(' ').filter((token) => token.length > 1));
      const intersection = [...proposedTokens].filter((token) => existingTokens.has(token)).length;
      const union = new Set([...proposedTokens, ...existingTokens]).size;
      if (proposed === existing || (union > 0 && intersection / union >= 0.8)) {
        warnings.push(`Possible duplicate: proposed task "${item.title}" resembles selected existing task "${task.title}" (${task.id}); review before import.`);
        break;
      }
    }
  }
  return warnings;
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
