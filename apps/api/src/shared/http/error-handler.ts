import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
};

function envelope(requestId: string, code: string, message: string): ErrorEnvelope {
  return { error: { code, message, requestId } };
}

export function notFoundHandler(): RequestHandler {
  return (request, response) => {
    response.status(404).json(envelope(request.requestId, 'NOT_FOUND', 'The requested resource was not found.'));
  };
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error instanceof HttpError) {
      response.status(error.statusCode).json(envelope(request.requestId, error.code, error.message));
      return;
    }

    if (error instanceof ZodError) {
      response.status(400).json(envelope(request.requestId, 'VALIDATION_ERROR', 'The request is invalid.'));
      return;
    }

    const parserErrorType =
      typeof error === 'object' && error !== null && 'type' in error && typeof error.type === 'string'
        ? error.type
        : undefined;
    if (parserErrorType === 'entity.parse.failed' || parserErrorType === 'request.size.invalid') {
      response.status(400).json(envelope(request.requestId, 'INVALID_JSON', 'The request body is invalid.'));
      return;
    }
    if (parserErrorType === 'entity.too.large') {
      response.status(413).json(envelope(request.requestId, 'PAYLOAD_TOO_LARGE', 'The request body is too large.'));
      return;
    }
    if (parserErrorType === 'charset.unsupported' || parserErrorType === 'encoding.unsupported') {
      response.status(415).json(envelope(request.requestId, 'UNSUPPORTED_MEDIA_TYPE', 'The request encoding is not supported.'));
      return;
    }

    const errorName = error instanceof Error ? error.name : 'UnknownError';
    logger.error({ requestId: request.requestId, errorName }, 'Unhandled request error');
    response.status(500).json(envelope(request.requestId, 'INTERNAL_ERROR', 'An unexpected error occurred.'));
  };
}
