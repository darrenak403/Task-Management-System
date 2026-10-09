import { z } from 'zod';
import { paginationSchema } from '../../shared/http/pagination.js';
import { planOutputSchema } from './planner.schemas.js';

export const plannerEditableFields = [
  'title', 'description', 'completionCriteria', 'priority', 'priorityReason',
  'estimateMinMinutes', 'estimateMaxMinutes', 'schedule', 'checklist', 'suggestedRole', 'assigneeId',
] as const;

export const plannerFieldLockSchema = z.object({ itemId: z.uuid(), field: z.enum(plannerEditableFields) }).strict();
export type PlannerFieldLock = z.infer<typeof plannerFieldLockSchema>;

const baseItemSchema = planOutputSchema.shape.items.element;
export const planDraftContentSchema = planOutputSchema.extend({
  items: z.array(baseItemSchema.extend({
    selected: z.boolean(),
    assigneeId: z.uuid().nullable(),
    position: z.number().int().min(0).max(19),
  })).min(1).max(20),
}).strict().superRefine((draft, context) => {
  const ids = new Set(draft.items.map((item) => item.id));
  const positions = new Set(draft.items.map((item) => item.position));
  if (ids.size !== draft.items.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Item IDs must be unique.' });
  }
  if (positions.size !== draft.items.length || [...positions].some((position, index) => position !== index)) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Item positions must be unique and contiguous.' });
  }
  for (const [index, item] of draft.items.entries()) {
    if (new Set(item.dependencies).size !== item.dependencies.length || item.dependencies.includes(item.id)) {
      context.addIssue({ code: 'custom', path: ['items', index, 'dependencies'], message: 'Dependencies must be unique and cannot include the item itself.' });
    }
  }
});

export const manualVersionRequestSchema = z.object({
  expectedActiveVersionId: z.uuid().nullable(),
  draft: planDraftContentSchema,
  fieldLocks: z.array(plannerFieldLockSchema).max(220).default([]),
}).strict().superRefine((input, context) => {
  const itemIds = new Set(input.draft.items.map((item) => item.id));
  const unique = new Set(input.fieldLocks.map((lock) => `${lock.itemId}:${lock.field}`));
  if (unique.size !== input.fieldLocks.length || input.fieldLocks.some((lock) => !itemIds.has(lock.itemId))) {
    context.addIssue({ code: 'custom', path: ['fieldLocks'], message: 'Field locks must refer to one unique field on an item in the draft.' });
  }
});

export const activateVersionRequestSchema = z.object({
  expectedActiveVersionId: z.uuid().nullable(),
}).strict();

export const planListQuerySchema = paginationSchema.strict();
export const versionListQuerySchema = paginationSchema.strict();

export const clonePlanRequestSchema = z.object({ requestKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/) }).strict();

const aiFieldMaskSchema = z.enum([
  'title', 'description', 'completionCriteria', 'priority', 'priorityReason',
  'estimateMinMinutes', 'estimateMaxMinutes', 'schedule', 'checklist', 'suggestedRole',
]);
export const generateRevisionRequestSchema = z.object({
  requestKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  action: z.enum(['RETRY', 'REGENERATE', 'SIMPLIFY', 'ADD_DETAIL', 'ADJUST_DEADLINE']),
  retryJobId: z.uuid().optional(),
  baseVersionId: z.uuid().nullable(),
  itemIds: z.array(z.uuid()).max(20).default([]),
  fieldMask: z.array(aiFieldMaskSchema).max(10).default([]),
  overrideLocks: z.array(plannerFieldLockSchema).max(220).default([]),
  deadline: z.iso.date().nullable().optional(),
}).strict().superRefine((input, context) => {
  if (new Set(input.itemIds).size !== input.itemIds.length) {
    context.addIssue({ code: 'custom', path: ['itemIds'], message: 'Target item IDs must be unique.' });
  }
  if (input.action === 'RETRY') {
    if (!input.retryJobId || input.baseVersionId !== null || input.itemIds.length > 0 || input.fieldMask.length > 0 || input.overrideLocks.length > 0 || input.deadline !== undefined) {
      context.addIssue({ code: 'custom', path: ['action'], message: 'Retry requires retryJobId and cannot include revision fields.' });
    }
    return;
  }
  if (input.retryJobId || !input.baseVersionId || input.itemIds.length === 0) {
    context.addIssue({ code: 'custom', path: ['baseVersionId'], message: 'A revision requires its active base version and target items.' });
  }
  if (input.action === 'REGENERATE' && input.fieldMask.length === 0) {
    context.addIssue({ code: 'custom', path: ['fieldMask'], message: 'Regeneration requires at least one field.' });
  }
  if (input.action === 'ADJUST_DEADLINE' && !input.deadline) {
    context.addIssue({ code: 'custom', path: ['deadline'], message: 'Deadline adjustment requires a target date.' });
  }
  if (input.action !== 'ADJUST_DEADLINE' && input.deadline !== undefined) {
    context.addIssue({ code: 'custom', path: ['deadline'], message: 'A deadline is only valid for ADJUST_DEADLINE.' });
  }
});

export const persistedCandidateSchema = z.object({
  action: z.enum(['REGENERATE', 'SIMPLIFY', 'ADD_DETAIL', 'ADJUST_DEADLINE']),
  baseVersionId: z.uuid(),
  itemIds: z.array(z.uuid()).min(1).max(20),
  fieldMask: z.array(aiFieldMaskSchema).max(10),
  overrideLocks: z.array(plannerFieldLockSchema).max(220),
  fieldLocks: z.array(plannerFieldLockSchema).max(220),
  baseDraft: planDraftContentSchema,
}).strict();

export const confirmPlanRequestSchema = z.object({
  versionId: z.uuid(),
  selectedItemIds: z.array(z.uuid()).min(1).max(20),
  requestKey: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict().superRefine((input, context) => {
  if (new Set(input.selectedItemIds).size !== input.selectedItemIds.length) {
    context.addIssue({ code: 'custom', path: ['selectedItemIds'], message: 'Selected item IDs must be unique.' });
  }
});

export type PlanDraftContent = z.infer<typeof planDraftContentSchema>;
export type ManualVersionRequest = z.infer<typeof manualVersionRequestSchema>;
export type GenerateRevisionRequest = z.infer<typeof generateRevisionRequestSchema>;
export type PersistedCandidate = z.infer<typeof persistedCandidateSchema>;
export type ConfirmPlanRequest = z.infer<typeof confirmPlanRequestSchema>;
