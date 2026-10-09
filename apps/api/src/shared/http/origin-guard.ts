import type { RequestHandler } from 'express';
import { HttpError } from './error-handler.js';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createOriginGuard(appOrigin: string): RequestHandler {
  const trustedOrigin = new URL(appOrigin).origin;

  return (request, _response, next) => {
    if (!MUTATION_METHODS.has(request.method)) {
      next();
      return;
    }

    const origin = request.get('origin');
    if (origin === 'null') {
      next(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'The request origin is not allowed.'));
      return;
    }

    const source = origin ?? request.get('referer');
    if (!source) {
      next(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'The request origin is not allowed.'));
      return;
    }

    let parsedSource: URL;
    try {
      parsedSource = new URL(source);
    } catch {
      next(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'The request origin is not allowed.'));
      return;
    }

    const originHeaderIsMalformed = origin !== undefined &&
      (parsedSource.origin !== origin || parsedSource.pathname !== '/' || parsedSource.search !== '' || parsedSource.hash !== '');
    if (parsedSource.origin !== trustedOrigin || parsedSource.username || parsedSource.password || originHeaderIsMalformed) {
      next(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'The request origin is not allowed.'));
      return;
    }

    const hasRequestBody = Number(request.get('content-length') ?? '0') > 0 || request.get('transfer-encoding') !== undefined;
    const contentType = request.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (hasRequestBody && contentType !== 'application/json') {
      next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Mutations require an application/json body.'));
      return;
    }

    next();
  };
}
