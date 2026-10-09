import type { RequestHandler } from 'express';
import { z } from 'zod';
import { parseInput } from '../../shared/http/pagination.js';
import { requireAuthenticated } from '../auth/session.middleware.js';
import type { AiJobService } from './job.service.js';
import type { AiPlanVersionService } from './version.service.js';
import type { AiPlanConfirmService } from './confirm.service.js';
import {
  clarifyJobSchema,
  createPlanSchema,
  jobLookupQuerySchema,
  jobParamsSchema,
  planParamsSchema,
} from './planner.schemas.js';
import {
  activateVersionRequestSchema,
  clonePlanRequestSchema,
  confirmPlanRequestSchema,
  generateRevisionRequestSchema,
  manualVersionRequestSchema,
  planListQuerySchema,
  versionListQuerySchema,
} from './version.schemas.js';

export function createPlannerController(service: AiJobService, versions: AiPlanVersionService, confirms: AiPlanConfirmService) {
  const listPlans: RequestHandler = async (request, response) => {
    const scope = parseInput(planParamsSchema.pick({ workspaceId: true, teamId: true }), request.params);
    const query = parseInput(planListQuerySchema, request.query);
    response.status(200).json(await versions.listPlans(requireAuthenticated(request).user.id, scope, query));
  };

  const create: RequestHandler = async (request, response) => {
    const scope = parseInput(planParamsSchema.pick({ workspaceId: true, teamId: true }), request.params);
    const input = parseInput(createPlanSchema, request.body);
    response.status(202).json({ data: await service.create(requireAuthenticated(request).user.id, scope, input) });
  };

  const getPlan: RequestHandler = async (request, response) => {
    const params = parseInput(planParamsSchema, request.params);
    const scope = { workspaceId: params.workspaceId, teamId: params.teamId };
    response.status(200).json(await service.getPlan(requireAuthenticated(request).user.id, scope, params.planId));
  };

  const getJob: RequestHandler = async (request, response) => {
    const params = parseInput(jobParamsSchema, request.params);
    const scope = { workspaceId: params.workspaceId, teamId: params.teamId };
    response.status(200).json(await service.getJob(requireAuthenticated(request).user.id, scope, params.jobId));
  };

  const findJob: RequestHandler = async (request, response) => {
    const scope = parseInput(planParamsSchema.pick({ workspaceId: true, teamId: true }), request.params);
    const query = parseInput(jobLookupQuerySchema, request.query);
    response.status(200).json(await service.findJobByRequestKey(requireAuthenticated(request).user.id, scope, query.requestKey));
  };

  const clarify: RequestHandler = async (request, response) => {
    const params = parseInput(jobParamsSchema, request.params);
    const input = parseInput(clarifyJobSchema, request.body);
    const scope = { workspaceId: params.workspaceId, teamId: params.teamId };
    response.status(202).json(await service.clarify(requireAuthenticated(request).user.id, scope, params.jobId, input));
  };

  const cancel: RequestHandler = async (request, response) => {
    const params = parseInput(jobParamsSchema, request.params);
    const scope = { workspaceId: params.workspaceId, teamId: params.teamId };
    response.status(200).json(await service.cancel(requireAuthenticated(request).user.id, scope, params.jobId));
  };

  const generate: RequestHandler = async (request, response) => {
    const params = parseInput(planParamsSchema, request.params);
    const input = parseInput(generateRevisionRequestSchema, request.body);
    const scope = { workspaceId: params.workspaceId, teamId: params.teamId };
    response.status(202).json(await service.generateRevision(requireAuthenticated(request).user.id, scope, params.planId, input));
  };

  const listVersions: RequestHandler = async (request, response) => {
    const params = parseInput(planParamsSchema, request.params);
    const query = parseInput(versionListQuerySchema, request.query);
    const scope = { workspaceId: params.workspaceId, teamId: params.teamId };
    response.status(200).json(await versions.listVersions(requireAuthenticated(request).user.id, scope, params.planId, query));
  };

  const getVersion: RequestHandler = async (request, response) => {
    const params = parseInput(planParamsSchema.extend({ versionId: z.uuid() }), request.params);
    const scope = { workspaceId: params.workspaceId, teamId: params.teamId };
    response.status(200).json(await versions.getVersion(requireAuthenticated(request).user.id, scope, params.planId, params.versionId));
  };

  const saveVersion: RequestHandler = async (request, response) => {
    const params = parseInput(planParamsSchema, request.params);
    const input = parseInput(manualVersionRequestSchema, request.body);
    const scope = { workspaceId: params.workspaceId, teamId: params.teamId };
    response.status(201).json(await versions.saveManualVersion(requireAuthenticated(request).user.id, scope, params.planId, input));
  };

  const activateVersion: RequestHandler = async (request, response) => {
    const params = parseInput(planParamsSchema.extend({ versionId: z.uuid() }), request.params);
    const input = parseInput(activateVersionRequestSchema, request.body);
    const scope = { workspaceId: params.workspaceId, teamId: params.teamId };
    response.status(200).json(await versions.activateCandidate(requireAuthenticated(request).user.id, scope, params.planId, params.versionId, input.expectedActiveVersionId));
  };

  const clone: RequestHandler = async (request, response) => {
    const params = parseInput(planParamsSchema, request.params);
    const input = parseInput(clonePlanRequestSchema, request.body);
    const scope = { workspaceId: params.workspaceId, teamId: params.teamId };
    response.status(201).json(await versions.clonePlan(requireAuthenticated(request).user.id, scope, params.planId, input.requestKey));
  };

  const confirm: RequestHandler = async (request, response) => {
    const params = parseInput(planParamsSchema, request.params);
    const input = parseInput(confirmPlanRequestSchema, request.body);
    const scope = { workspaceId: params.workspaceId, teamId: params.teamId };
    const result = await confirms.confirm(requireAuthenticated(request).user.id, scope, params.planId, input);
    response.status(result.statusCode).json({ data: result.data });
  };

  return { listPlans, create, getPlan, getJob, findJob, clarify, cancel, generate, listVersions, getVersion, saveVersion, activateVersion, clone, confirm };
}
