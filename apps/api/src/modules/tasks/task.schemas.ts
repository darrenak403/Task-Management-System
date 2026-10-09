import { z } from 'zod';
import { paginationSchema } from '../../shared/http/pagination.js';

export const taskStatusSchema = z.enum(['TODO', 'IN_PROGRESS', 'DONE']);
export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const taskIdParamsSchema = z.object({ workspaceId: z.uuid(), teamId: z.uuid(), taskId: z.uuid() }).strict();
export const taskCollectionParamsSchema = z.object({ workspaceId: z.uuid(), teamId: z.uuid() }).strict();
export const taskDependenciesRequestSchema = z.object({
  prerequisiteIds: z.array(z.uuid()).max(100),
  expectedUpdatedAt: z.iso.datetime(),
}).strict().superRefine((input, context) => {
  if (new Set(input.prerequisiteIds).size !== input.prerequisiteIds.length) {
    context.addIssue({ code: 'custom', path: ['prerequisiteIds'], message: 'Prerequisite IDs must be unique.' });
  }
});
const dateOnly = z.iso.date().refine((value) => !value.startsWith('0000-'), 'Date must use a year from 0001 through 9999.');

export const taskScheduleSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('NONE') }).strict(),
  z.object({
    mode: z.literal('RELATIVE'),
    startDay: z.number().int().min(1).max(365).nullable(),
    dueDay: z.number().int().min(1).max(365).nullable(),
  }).strict().refine((value) => value.startDay === null || value.dueDay === null || value.startDay <= value.dueDay),
  z.object({
    mode: z.literal('ABSOLUTE'),
    startDate: dateOnly.nullable(),
    dueDate: dateOnly.nullable(),
  }).strict().refine((value) => !value.startDate || !value.dueDate || value.startDate <= value.dueDate),
]);

const checklistItemSchema = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(1).max(200),
  isCompleted: z.boolean().default(false),
}).strict();

const taskFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5_000),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueDate: dateOnly.nullable(),
  assigneeId: z.uuid().nullable(),
  completionCriteria: z.string().trim().max(2_000),
  priorityReason: z.string().trim().max(1_000),
  estimateMinMinutes: z.number().int().min(1).max(525_600).nullable(),
  estimateMaxMinutes: z.number().int().min(1).max(525_600).nullable(),
};

export const createTaskSchema = z.object({
  title: taskFields.title,
  description: taskFields.description.optional(),
  status: taskFields.status.optional(),
  priority: taskFields.priority.optional(),
  dueDate: taskFields.dueDate.optional(),
  assigneeId: taskFields.assigneeId.optional(),
  completionCriteria: taskFields.completionCriteria.optional(),
  priorityReason: taskFields.priorityReason.optional(),
  estimateMinMinutes: taskFields.estimateMinMinutes.optional(),
  estimateMaxMinutes: taskFields.estimateMaxMinutes.optional(),
  schedule: taskScheduleSchema.optional(),
  checklist: z.array(checklistItemSchema).max(10).optional(),
}).strict().superRefine((input, context) => {
  validateEstimatePair(input, context);
  if (input.schedule && input.dueDate !== undefined) {
    const scheduledDue = input.schedule.mode === 'ABSOLUTE' ? input.schedule.dueDate : null;
    if (input.dueDate !== scheduledDue) context.addIssue({ code: 'custom', path: ['dueDate'], message: 'Provide dueDate or schedule, not conflicting values.' });
  }
});

export const updateTaskSchema = z.object({
  title: taskFields.title.optional(),
  description: taskFields.description.optional(),
  status: taskFields.status.optional(),
  priority: taskFields.priority.optional(),
  dueDate: taskFields.dueDate.optional(),
  assigneeId: taskFields.assigneeId.optional(),
  completionCriteria: taskFields.completionCriteria.optional(),
  priorityReason: taskFields.priorityReason.optional(),
  estimateMinMinutes: taskFields.estimateMinMinutes.optional(),
  estimateMaxMinutes: taskFields.estimateMaxMinutes.optional(),
  schedule: taskScheduleSchema.optional(),
  checklist: z.array(checklistItemSchema).max(10).optional(),
}).strict().superRefine((value, context) => {
  if (Object.keys(value).length === 0) context.addIssue({ code: 'custom', message: 'At least one field is required.' });
  validateEstimatePair(value, context);
  if (value.schedule && value.dueDate !== undefined) {
    const scheduledDue = value.schedule.mode === 'ABSOLUTE' ? value.schedule.dueDate : null;
    if (value.dueDate !== scheduledDue) context.addIssue({ code: 'custom', path: ['dueDate'], message: 'Provide dueDate or schedule, not conflicting values.' });
  }
  const ids = value.checklist?.flatMap((item) => item.id ? [item.id] : []) ?? [];
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['checklist'], message: 'Checklist IDs must be unique.' });
});

export const listTasksQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  teamId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
}).strict();

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type TaskDependenciesRequest = z.infer<typeof taskDependenciesRequestSchema>;

function validateEstimatePair(
  value: { estimateMinMinutes?: number | null | undefined; estimateMaxMinutes?: number | null | undefined },
  context: z.RefinementCtx,
): void {
  if ((value.estimateMinMinutes === null) !== (value.estimateMaxMinutes === null)) {
    context.addIssue({ code: 'custom', path: ['estimateMinMinutes'], message: 'Clear both estimate bounds together.' });
  }
  if (value.estimateMinMinutes !== undefined && value.estimateMaxMinutes !== undefined &&
    value.estimateMinMinutes !== null && value.estimateMaxMinutes !== null && value.estimateMinMinutes > value.estimateMaxMinutes) {
    context.addIssue({ code: 'custom', path: ['estimateMaxMinutes'], message: 'Maximum estimate must be at least the minimum estimate.' });
  }
}
