import type { RequestHandler } from 'express';
import { requireAuthenticated } from '../auth/session.middleware.js';
import { parseInput } from '../../shared/http/pagination.js';
import type { TaskService } from './task.service.js';
import type { TaskDependencyService } from './dependency.service.js';
import {
  createTaskSchema,
  listTasksQuerySchema,
  taskCollectionParamsSchema,
  taskIdParamsSchema,
  updateTaskSchema,
  taskDependenciesRequestSchema,
} from './task.schemas.js';

export function createTaskController(service: TaskService) {
  const list: RequestHandler = async (request, response) => {
    const { workspaceId } = parseInput(taskCollectionParamsSchema.pick({ workspaceId: true }), request.params);
    const query = parseInput(listTasksQuerySchema, request.query);
    response.status(200).json(await service.list(requireAuthenticated(request).user.id, workspaceId, query));
  };

  const create: RequestHandler = async (request, response) => {
    const { workspaceId, teamId } = parseInput(taskCollectionParamsSchema, request.params);
    const input = parseInput(createTaskSchema, request.body);
    response.status(201).json({ data: await service.create(requireAuthenticated(request).user.id, workspaceId, teamId, input) });
  };

  const get: RequestHandler = async (request, response) => {
    const { workspaceId, teamId, taskId } = parseInput(taskIdParamsSchema, request.params);
    response.status(200).json({ data: await service.get(requireAuthenticated(request).user.id, workspaceId, teamId, taskId) });
  };

  const update: RequestHandler = async (request, response) => {
    const { workspaceId, teamId, taskId } = parseInput(taskIdParamsSchema, request.params);
    const input = parseInput(updateTaskSchema, request.body);
    response.status(200).json({ data: await service.update(requireAuthenticated(request).user.id, workspaceId, teamId, taskId, input) });
  };

  const remove: RequestHandler = async (request, response) => {
    const { workspaceId, teamId, taskId } = parseInput(taskIdParamsSchema, request.params);
    await service.remove(requireAuthenticated(request).user.id, workspaceId, teamId, taskId);
    response.status(204).end();
  };

  const replaceDependencies = (dependencyService: TaskDependencyService): RequestHandler => async (request, response) => {
    const { workspaceId, teamId, taskId } = parseInput(taskIdParamsSchema, request.params);
    const input = parseInput(taskDependenciesRequestSchema, request.body);
    response.status(200).json(await dependencyService.replace(requireAuthenticated(request).user.id, workspaceId, teamId, taskId, input));
  };

  return { list, create, get, update, remove, replaceDependencies };
}
