import { Router } from 'express';

export type ReadinessProbe = () => Promise<boolean>;

export function createHealthRoutes(readinessProbe: ReadinessProbe = async () => true, appBuildSha?: string): Router {
  const router = Router();
  const releaseHeader = /^[a-f0-9]{40,64}$/i.test(appBuildSha ?? '') ? appBuildSha : undefined;

  router.get('/health/live', (_request, response) => {
    if (releaseHeader) response.setHeader('X-Release-Sha', releaseHeader);
    response.status(200).json({ status: 'ok' });
  });

  router.get('/health/ready', async (_request, response) => {
    try {
      const ready = await readinessProbe();
      if (releaseHeader) response.setHeader('X-Release-Sha', releaseHeader);
      response.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
    } catch {
      if (releaseHeader) response.setHeader('X-Release-Sha', releaseHeader);
      response.status(503).json({ status: 'unavailable' });
    }
  });

  return router;
}
