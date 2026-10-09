import type { RequestHandler } from 'express';
import { requireAuthenticated } from '../auth/session.middleware.js';
import { parseInput } from '../../shared/http/pagination.js';
import type { TeamService } from './team.service.js';
import {
  addTeamMemberSchema,
  createTeamSchema,
  teamMemberListQuerySchema,
  teamMemberParamsSchema,
  teamParamsSchema,
  updateTeamSchema,
} from './team.schemas.js';

export function createTeamController(service: TeamService) {
  const list: RequestHandler = async (request, response) => {
    const { workspaceId } = parseInput(teamParamsSchema.pick({ workspaceId: true }), request.params);
    const pagination = parseInput(teamMemberListQuerySchema, request.query);
    response.status(200).json(await service.list(requireAuthenticated(request).user.id, workspaceId, pagination));
  };

  const create: RequestHandler = async (request, response) => {
    const { workspaceId } = parseInput(teamParamsSchema.pick({ workspaceId: true }), request.params);
    const input = parseInput(createTeamSchema, request.body);
    response.status(201).json({ data: await service.create(requireAuthenticated(request).user.id, workspaceId, input) });
  };

  const get: RequestHandler = async (request, response) => {
    const { workspaceId, teamId } = parseInput(teamParamsSchema, request.params);
    response.status(200).json({ data: await service.get(requireAuthenticated(request).user.id, workspaceId, teamId) });
  };

  const update: RequestHandler = async (request, response) => {
    const { workspaceId, teamId } = parseInput(teamParamsSchema, request.params);
    const input = parseInput(updateTeamSchema, request.body);
    response.status(200).json({ data: await service.update(requireAuthenticated(request).user.id, workspaceId, teamId, input) });
  };

  const listMembers: RequestHandler = async (request, response) => {
    const { workspaceId, teamId } = parseInput(teamParamsSchema, request.params);
    const pagination = parseInput(teamMemberListQuerySchema, request.query);
    response.status(200).json(await service.listMembers(requireAuthenticated(request).user.id, workspaceId, teamId, pagination));
  };

  const addMember: RequestHandler = async (request, response) => {
    const { workspaceId, teamId } = parseInput(teamParamsSchema, request.params);
    const input = parseInput(addTeamMemberSchema, request.body);
    response.status(201).json({ data: await service.addMember(requireAuthenticated(request).user.id, workspaceId, teamId, input) });
  };

  const removeMember: RequestHandler = async (request, response) => {
    const { workspaceId, teamId, userId } = parseInput(teamMemberParamsSchema, request.params);
    await service.removeMember(requireAuthenticated(request).user.id, workspaceId, teamId, userId);
    response.status(204).end();
  };

  return { list, create, get, update, listMembers, addMember, removeMember };
}
