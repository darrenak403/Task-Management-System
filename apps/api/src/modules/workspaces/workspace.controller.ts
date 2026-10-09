import type { RequestHandler } from 'express';
import { parseInput, paginationSchema } from '../../shared/http/pagination.js';
import type { WorkspaceService } from './workspace.service.js';
import {
  addWorkspaceMemberSchema,
  createWorkspaceSchema,
  updateWorkspaceMemberSchema,
  updateWorkspaceSchema,
  workspaceIdParamsSchema,
  workspaceMemberListQuerySchema,
  workspaceMemberParamsSchema,
} from './workspace.schemas.js';
import { requireAuthenticated } from '../auth/session.middleware.js';

export function createWorkspaceController(service: WorkspaceService) {
  const list: RequestHandler = async (request, response) => {
    const pagination = parseInput(paginationSchema, request.query);
    response.status(200).json(await service.list(requireAuthenticated(request).user.id, pagination));
  };

  const create: RequestHandler = async (request, response) => {
    const input = parseInput(createWorkspaceSchema, request.body);
    const workspace = await service.create(requireAuthenticated(request).user.id, input);
    response.status(201).json({ data: workspace });
  };

  const get: RequestHandler = async (request, response) => {
    const { workspaceId } = parseInput(workspaceIdParamsSchema, request.params);
    response.status(200).json({ data: await service.get(requireAuthenticated(request).user.id, workspaceId) });
  };

  const update: RequestHandler = async (request, response) => {
    const { workspaceId } = parseInput(workspaceIdParamsSchema, request.params);
    const input = parseInput(updateWorkspaceSchema, request.body);
    response.status(200).json({ data: await service.update(requireAuthenticated(request).user.id, workspaceId, input) });
  };

  const listMembers: RequestHandler = async (request, response) => {
    const { workspaceId } = parseInput(workspaceIdParamsSchema, request.params);
    const pagination = parseInput(workspaceMemberListQuerySchema, request.query);
    response.status(200).json(await service.listMembers(requireAuthenticated(request).user.id, workspaceId, pagination));
  };

  const addMember: RequestHandler = async (request, response) => {
    const { workspaceId } = parseInput(workspaceIdParamsSchema, request.params);
    const input = parseInput(addWorkspaceMemberSchema, request.body);
    const member = await service.addMember(requireAuthenticated(request).user.id, workspaceId, input);
    response.status(201).json({ data: member });
  };

  const updateMember: RequestHandler = async (request, response) => {
    const { workspaceId, userId } = parseInput(workspaceMemberParamsSchema, request.params);
    const input = parseInput(updateWorkspaceMemberSchema, request.body);
    const member = await service.updateMember(requireAuthenticated(request).user.id, workspaceId, userId, input);
    response.status(200).json({ data: member });
  };

  const removeMember: RequestHandler = async (request, response) => {
    const { workspaceId, userId } = parseInput(workspaceMemberParamsSchema, request.params);
    await service.removeMember(requireAuthenticated(request).user.id, workspaceId, userId);
    response.status(204).end();
  };

  return { list, create, get, update, listMembers, addMember, updateMember, removeMember };
}
