import type { RequestHandler } from 'express';
import { currentUserId } from '../auth/auth.policy.js';
import { HttpError } from '../../shared/http/error-handler.js';
import { putGeminiCredentialSchema, updateGeminiModelSchema } from './credentials.schemas.js';
import type { GeminiCredentialService } from './credentials.service.js';

export function createGeminiCredentialController(service: GeminiCredentialService) {
  const get: RequestHandler = async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({ data: await service.getMetadata(currentUserId(request)) });
  };

  const put: RequestHandler = async (request, response) => {
    const parsed = putGeminiCredentialSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The request is invalid.');
    response.setHeader('Cache-Control', 'no-store');
    const metadata = await service.set(currentUserId(request), parsed.data.key, parsed.data.model);
    response.status(200).json({ data: metadata });
  };

  const updateModel: RequestHandler = async (request, response) => {
    const parsed = updateGeminiModelSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The request is invalid.');
    response.setHeader('Cache-Control', 'no-store');
    const metadata = await service.updateModel(currentUserId(request), parsed.data.model);
    response.status(200).json({ data: metadata });
  };

  const test: RequestHandler = async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({ data: await service.test(currentUserId(request)) });
  };

  const remove: RequestHandler = async (request, response) => {
    await service.remove(currentUserId(request));
    response.status(204).end();
  };

  return { get, put, updateModel, test, remove };
}
