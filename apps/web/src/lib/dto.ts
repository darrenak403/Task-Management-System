import type { components } from './api-types';

type Schemas = components['schemas'];

export type User = Schemas['UserDto'];
export type PageMeta = Schemas['PageMeta'];
export type Page<T> = { data: T[]; meta: PageMeta };

export type WorkspaceRole = Schemas['WorkspaceRole'];
export type Workspace = Schemas['WorkspaceDto'];
export type WorkspaceMember = Schemas['WorkspaceMemberDto'];
export type Team = Schemas['TeamDto'];
export type TeamMember = Schemas['TeamMemberDto'];

export type TaskStatus = Schemas['TaskStatus'];
export type TaskPriority = Schemas['TaskPriority'];
export type Task = Schemas['TaskDto'];
export type CreateTaskInput = Schemas['CreateTaskRequest'];
export type UpdateTaskInput = Schemas['UpdateTaskRequest'];
export type Dashboard = Schemas['DashboardResponse']['data'];

export type GeminiCredential = Schemas['GeminiCredentialMetadata'];
export type AiPlannerStatus = Schemas['AiPlannerStatus'];
export type AiJob = Schemas['AiJob'];
export type AiPlan = Schemas['AiPlan'];
export type AiPlanSummary = Schemas['AiPlanSummary'];
export type AiPlanVersion = Schemas['AiPlanVersion'];
export type PlanDraftContent = Schemas['PlanDraftContent'];
export type PlanDraftItem = Schemas['PlanDraftItem'];
export type AiImportReceipt = Schemas['AiImportReceipt'];

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'] as const satisfies readonly TaskStatus[];
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const satisfies readonly TaskPriority[];
