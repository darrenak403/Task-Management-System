import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

export const requestIdMiddleware: RequestHandler = (request, response, next) => {
  request.requestId = randomUUID();
  response.setHeader('X-Request-Id', request.requestId);
  next();
};
