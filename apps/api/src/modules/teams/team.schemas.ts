import { z } from 'zod';
import { paginationSchema } from '../../shared/http/pagination.js';

const teamName = z.string().trim().min(1).max(100);

export const teamParamsSchema = z.object({ workspaceId: z.uuid(), teamId: z.uuid() }).strict();
export const teamMemberParamsSchema = z.object({ workspaceId: z.uuid(), teamId: z.uuid(), userId: z.uuid() }).strict();
export const createTeamSchema = z.object({ name: teamName }).strict();
export const updateTeamSchema = createTeamSchema;
export const teamMemberListQuerySchema = paginationSchema;
export const addTeamMemberSchema = z.object({ userId: z.uuid() }).strict();

export type TeamNameInput = z.infer<typeof createTeamSchema>;
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;
