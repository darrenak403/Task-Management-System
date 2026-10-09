import { Router, type NextFunction, type Request, type Response } from 'express';
import * as swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi.js';

export function createOpenApiRoutes(): Router {
  const router = Router();
  router.get('/openapi.json', (_request: Request, response: Response) => response.json(openApiDocument));
  router.use(
    '/docs',
    (_request: Request, response: Response, next: NextFunction) => {
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';",
      );
      next();
    },
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument as unknown as swaggerUi.JsonObject, {
      customSiteTitle: 'Task Management System API',
      explorer: true,
      swaggerOptions: { displayRequestDuration: true, filter: true, persistAuthorization: true },
    }),
  );
  return router;
}
