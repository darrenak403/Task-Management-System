import { z } from 'zod';
import { paginationSchema } from '../../shared/http/pagination.js';

const workspaceName = z.string().trim().min(1).max(100);

export const workspaceIdParamsSchema = z.object({ workspaceId: z.uuid() }).strict();
export const workspaceMemberParamsSchema = z.object({ workspaceId: z.uuid(), userId: z.uuid() }).strict();
export const createWorkspaceSchema = z.object({ name: workspaceName }).strict();
export const updateWorkspaceSchema = createWorkspaceSchema;
export const workspaceMemberListQuerySchema = paginationSchema;
export const memberCandidateQuerySchema = z.object({ search: z.string().trim().max(100).optional() }).strict();
export const addWorkspaceMemberSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
export const updateWorkspaceMemberSchema = z.object({ role: z.enum(['ADMIN', 'MEMBER']) }).strict();

export type WorkspaceNameInput = z.infer<typeof createWorkspaceSchema>;
export type AddWorkspaceMemberInput = z.infer<typeof addWorkspaceMemberSchema>;
export type UpdateWorkspaceMemberInput = z.infer<typeof updateWorkspaceMemberSchema>;
