import { describe, expect, it } from 'vitest';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { openApiDocument } from '../../src/modules/openapi/openapi.js';

type DocumentSchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, unknown>;
};
type DocumentResponse = {
  content?: Record<string, { schema?: { $ref?: string; type?: string } }>;
  headers?: Record<string, unknown>;
};
type DocumentOperation = { operationId?: string; responses?: Record<string, DocumentResponse> };
type OpenApiShape = {
  paths: Record<string, Record<string, DocumentOperation>>;
  components: { schemas: Record<string, DocumentSchema> };
};

const document = openApiDocument as unknown as OpenApiShape;
const app = createApp({ logger: pino({ level: 'silent' }) });
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

describe('OpenAPI contract', () => {
  it('documents every route operation with unique operation IDs and resolvable response schemas', () => {
    const operations = Object.values(document.paths).flatMap((pathItem) =>
      Object.entries(pathItem)
        .filter(([method]) => HTTP_METHODS.has(method))
        .map(([, operation]) => operation),
    );
    const operationIds = operations.map((operation) => operation.operationId);
    expect(operationIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(operationIds).size).toBe(operations.length);
    expect(operations.length).toBe(49);

    for (const operation of operations) {
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!status.startsWith('2')) continue;
        const schema = response.content?.['application/json']?.schema;
        if (!schema?.$ref) continue;
        const schemaName = schema.$ref.replace('#/components/schemas/', '');
        const resolved = document.components.schemas[schemaName];
        expect(resolved).toBeDefined();
        if (!['getLiveness', 'getReadiness'].includes(operation.operationId ?? '')) {
          expect(resolved?.required).toContain('data');
        }
      }
    }
  });

  it('describes data envelopes, empty delete responses, and session cookie rotation', () => {
    const register = document.paths['/auth/register']?.post;
    const logout = document.paths['/auth/logout']?.post;
    const taskCreate = document.paths['/workspaces/{workspaceId}/teams/{teamId}/tasks']?.post;
    const registerResponse = register?.responses?.['201'];
    const taskResponse = taskCreate?.responses?.['201'];
    const registerSchemaName = registerResponse?.content?.['application/json']?.schema?.$ref?.split('/').at(-1);
    const taskSchemaName = taskResponse?.content?.['application/json']?.schema?.$ref?.split('/').at(-1);
    const registerSchema = registerSchemaName ? document.components.schemas[registerSchemaName] : undefined;
    const taskSchema = taskSchemaName ? document.components.schemas[taskSchemaName] : undefined;

    expect(registerResponse?.headers?.['Set-Cookie']).toBeDefined();
    expect(logout?.responses?.['204']?.headers?.['Set-Cookie']).toBeDefined();
    expect(registerSchema?.required).toContain('data');
    expect(taskSchema?.required).toContain('data');
    expect(document.paths['/workspaces/{workspaceId}/teams/{teamId}/tasks/{taskId}']?.delete?.responses?.['204']?.content).toBeUndefined();
    expect(document.paths['/workspaces/{workspaceId}/teams/{teamId}/tasks/{taskId}/dependencies']?.patch).toBeDefined();
    expect(document.paths['/workspaces/{workspaceId}/teams/{teamId}/ai-plans/{planId}/confirm']?.post?.responses?.['201']).toBeDefined();
    expect(document.paths['/workspaces/{workspaceId}/teams/{teamId}/ai-plans/{planId}/confirm']?.post?.responses?.['200']).toBeDefined();
    expect(document.paths['/workspaces/{workspaceId}/teams/{teamId}/ai-planner/status']).toBeUndefined();
    expect(document.paths['/workspaces/{workspaceId}/teams/{teamId}/ai-jobs/{jobId}/retry']).toBeUndefined();
  });

  it('serves the JSON contract and interactive Swagger UI', async () => {
    const json = await request(app).get('/api/openapi.json');
    const swagger = await request(app).get('/api/docs/');

    expect(json.status).toBe(200);
    expect(json.body.openapi).toBe('3.1.0');
    expect(swagger.status).toBe(200);
    expect(swagger.headers['content-type']).toContain('text/html');
    expect(swagger.text).toContain('Task Management System API');
  });
});
