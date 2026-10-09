import type { Prisma } from '../../generated/prisma/client.js';

export const taskPublicSelect = {
  id: true,
  workspaceId: true,
  teamId: true,
  createdBy: true,
  assigneeId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  completionCriteria: true,
  priorityReason: true,
  estimateMinMinutes: true,
  estimateMaxMinutes: true,
  plannedStartDate: true,
  relativeStartDay: true,
  relativeDueDay: true,
  checklist: { orderBy: { position: 'asc' } },
  prerequisites: { select: { prerequisiteId: true }, orderBy: { prerequisiteId: 'asc' } },
  dependents: { select: { taskId: true }, orderBy: { taskId: 'asc' } },
  createdAt: true,
  updatedAt: true,
} as const;

export type TaskRecord = Prisma.TaskGetPayload<{ select: typeof taskPublicSelect }>;

export function toTaskDto(task: TaskRecord) {
  const { checklist, prerequisites, dependents, plannedStartDate, relativeStartDay, relativeDueDay, ...taskFields } = task;
  const relative = task.relativeStartDay !== null || task.relativeDueDay !== null;
  const absolute = task.plannedStartDate !== null || task.dueDate !== null;
  return {
    ...taskFields,
    dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null,
    schedule: relative
      ? { mode: 'RELATIVE' as const, startDay: relativeStartDay, dueDay: relativeDueDay }
      : absolute
        ? { mode: 'ABSOLUTE' as const, startDate: plannedStartDate?.toISOString().slice(0, 10) ?? null, dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null }
        : { mode: 'NONE' as const },
    checklist: checklist.map(({ id, position, title, isCompleted }) => ({ id, position, title, isCompleted })),
    dependencies: {
      prerequisites: prerequisites.map((dependency) => dependency.prerequisiteId),
      dependents: dependents.map((dependency) => dependency.taskId),
    },
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
