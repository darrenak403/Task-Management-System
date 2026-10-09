import { z } from 'zod';

const requestKey = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

const memberProfileSchema = z.object({
  userId: z.uuid(),
  role: z.string().trim().min(1).max(80).nullable().default(null),
  capacityMinutesPerDay: z.number().int().min(1).max(1_440).nullable().default(null),
  workingDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
}).strict().superRefine((profile, context) => {
  if (new Set(profile.workingDays).size !== profile.workingDays.length) {
    context.addIssue({ code: 'custom', path: ['workingDays'], message: 'Working days must be unique.' });
  }
  if (profile.capacityMinutesPerDay !== null && profile.workingDays.length === 0) {
    context.addIssue({ code: 'custom', path: ['workingDays'], message: 'Declare working days when setting daily capacity.' });
  }
});

export const createPlanSchema = z.object({
  requestKey,
  goal: z.string().trim().min(20).max(4_000),
  constraints: z.string().trim().max(4_000).default(''),
  detailLevel: z.enum(['SIMPLE', 'BALANCED', 'DETAILED']).default('BALANCED'),
  strategy: z.enum(['FASTEST', 'BALANCED', 'QUALITY_FIRST']).default('BALANCED'),
  startDate: dateOnly.nullable().default(null),
  targetDate: dateOnly.nullable().default(null),
  durationDays: z.number().int().min(1).max(365).nullable().default(null),
  includeExistingTasks: z.boolean().default(false),
  existingTaskIds: z.array(z.uuid()).max(50).default([]),
  includeMembers: z.boolean().default(false),
  memberIds: z.array(z.uuid()).max(20).default([]),
  memberProfiles: z.array(memberProfileSchema).max(20).default([]),
  consent: z.object({
    providerDisclosureAccepted: z.literal(true),
    billingAuthorityConfirmed: z.literal(true),
    selectedContextReviewed: z.literal(true),
  }).strict(),
}).strict().superRefine((input, context) => {
  if (input.startDate && input.targetDate && input.startDate > input.targetDate) {
    context.addIssue({ code: 'custom', path: ['targetDate'], message: 'Target date must not precede the start date.' });
  }
  if (!input.includeExistingTasks && input.existingTaskIds.length > 0) {
    context.addIssue({ code: 'custom', path: ['existingTaskIds'], message: 'Task IDs require task context consent.' });
  }
  if (!input.includeMembers && (input.memberIds.length > 0 || input.memberProfiles.length > 0)) {
    context.addIssue({ code: 'custom', path: ['memberIds'], message: 'Member IDs require member context consent.' });
  }
  if (new Set(input.existingTaskIds).size !== input.existingTaskIds.length) {
    context.addIssue({ code: 'custom', path: ['existingTaskIds'], message: 'Task IDs must be unique.' });
  }
  if (new Set(input.memberIds).size !== input.memberIds.length) {
    context.addIssue({ code: 'custom', path: ['memberIds'], message: 'Member IDs must be unique.' });
  }
  const profileIds = input.memberProfiles.map((profile) => profile.userId);
  if (new Set(profileIds).size !== profileIds.length || profileIds.some((id) => !input.memberIds.includes(id))) {
    context.addIssue({ code: 'custom', path: ['memberProfiles'], message: 'Profiles must be unique and refer to selected members.' });
  }
});

export const clarifyJobSchema = z.object({
  requestKey,
  answers: z.array(z.string().trim().min(1).max(1_000)).min(1).max(3).optional(),
  allowAssumptions: z.boolean().optional(),
}).strict().refine((input) => Boolean(input.answers?.length) !== Boolean(input.allowAssumptions), {
  message: 'Provide answers or explicitly accept assumptions.',
});

export const retryJobSchema = z.object({ requestKey }).strict();

export const cancelJobParamsSchema = z.object({ jobId: z.uuid() }).strict();
export const planParamsSchema = z.object({ workspaceId: z.uuid(), teamId: z.uuid(), planId: z.uuid() }).strict();
export const jobParamsSchema = z.object({ workspaceId: z.uuid(), teamId: z.uuid(), jobId: z.uuid() }).strict();
export const jobLookupQuerySchema = z.object({ requestKey }).strict();

export const understandingOutputSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(10),
  questions: z.array(z.string().trim().min(1).max(500)).max(3),
}).strict();

const scheduleSchema = z.discriminatedUnion('mode', [
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

export const planOutputSchema = z.object({
  planTitle: z.string().trim().min(1).max(120),
  goalSummary: z.string().trim().min(1).max(2_000),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(10),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
  items: z.array(z.object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5_000),
    completionCriteria: z.string().trim().min(1).max(2_000),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    priorityReason: z.string().trim().min(1).max(1_000),
    estimateMinMinutes: z.number().int().min(1).max(525_600).nullable(),
    estimateMaxMinutes: z.number().int().min(1).max(525_600).nullable(),
    schedule: scheduleSchema,
    dependencies: z.array(z.uuid()).max(20),
    checklist: z.array(z.string().trim().min(1).max(200)).max(10),
    suggestedRole: z.string().trim().min(1).max(80).nullable(),
  }).strict().superRefine((item, context) => {
    if ((item.estimateMinMinutes === null) !== (item.estimateMaxMinutes === null)) {
      context.addIssue({ code: 'custom', path: ['estimateMinMinutes'], message: 'Estimates must be both present or both absent.' });
    }
    if (item.estimateMinMinutes !== null && item.estimateMaxMinutes !== null && item.estimateMinMinutes > item.estimateMaxMinutes) {
      context.addIssue({ code: 'custom', path: ['estimateMaxMinutes'], message: 'Maximum estimate must not be less than minimum.' });
    }
  })).min(1).max(20),
}).strict();

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type PlanOutput = z.infer<typeof planOutputSchema>;
export type UnderstandingOutput = z.infer<typeof understandingOutputSchema>;
