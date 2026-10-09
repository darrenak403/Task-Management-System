import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = resolve(apiRoot, '../..');
const tsxCli = resolve(repositoryRoot, 'node_modules/tsx/dist/cli.mjs');
const smokeScript = resolve(apiRoot, 'tests/smoke/api-smoke.ts');
const releaseSha = 'b'.repeat(40);

let server: Server | undefined;

afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolveClose, reject) => server?.close((error) => error ? reject(error) : resolveClose()));
  server = undefined;
});

describe('backend API smoke script', () => {
  it('accepts healthy readiness, the expected release SHA, and the 49-operation OpenAPI contract', async () => {
    const baseUrl = await startStubApi({ operationCount: 49 });
    const result = await runSmoke(baseUrl, releaseSha);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Backend smoke passed');
  });

  it('rejects a release SHA mismatch and an incomplete OpenAPI contract', async () => {
    const baseUrl = await startStubApi({ operationCount: 48 });
    const wrongRelease = await runSmoke(baseUrl, 'c'.repeat(40));
    const wrongContract = await runSmoke(baseUrl, releaseSha);

    expect(wrongRelease.status).not.toBe(0);
    expect(wrongRelease.stderr).toContain('expected release SHA');
    expect(wrongContract.status).not.toBe(0);
    expect(wrongContract.stderr).toContain('operation count did not match');
  });

  it('rejects an API that is not ready', async () => {
    const baseUrl = await startStubApi({ operationCount: 49, readinessStatus: 503 });
    const result = await runSmoke(baseUrl, releaseSha);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('readiness returned HTTP 503');
  });
});

async function startStubApi(options: { operationCount: number; readinessStatus?: number }): Promise<string> {
  server = createServer((request, response) => {
    if (request.url === '/api/health/ready') {
      response.writeHead(options.readinessStatus ?? 200, { 'content-type': 'application/json', 'x-release-sha': releaseSha });
      response.end(JSON.stringify({ status: options.readinessStatus === 503 ? 'unavailable' : 'ok' }));
      return;
    }
    if (request.url === '/api/openapi.json') {
      const paths = Object.fromEntries(Array.from({ length: options.operationCount }, (_, index) => [`/test/${index}`, { get: {} }]));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ openapi: '3.1.0', paths }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolveListen, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The local smoke-test server did not bind a TCP port.');
  return `http://127.0.0.1:${address.port}`;
}

function runSmoke(baseUrl: string, expectedSha: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [tsxCli, smokeScript], {
    cwd: apiRoot,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'test',
      API_SMOKE_BASE_URL: baseUrl,
      EXPECTED_RELEASE_SHA: expectedSha,
    },
  });
  return new Promise((resolveRun, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('The smoke script exceeded its 8-second test timeout.'));
    }, 8_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (status) => {
      clearTimeout(timeout);
      resolveRun({ status, stdout, stderr });
    });
  });
}
