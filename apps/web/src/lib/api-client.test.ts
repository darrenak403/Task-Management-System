import { describe, expect, it, vi } from 'vitest';

import { api } from './api-client';
import { ApiError, NETWORK_ERROR, UPSTREAM_UNAVAILABLE, fieldErrors, isAbortError, isOutcomeUnknown } from './api-errors';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

/** Each entry is one fetch outcome: a Response resolves, anything else rejects. */
function stubFetch(...outcomes: unknown[]) {
  const mock = vi.fn<typeof fetch>();
  for (const outcome of outcomes) {
    if (outcome instanceof Response) mock.mockResolvedValueOnce(outcome);
    else mock.mockRejectedValueOnce(outcome);
  }
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (error: unknown) => error,
  );
}

describe('api client', () => {
  it('calls the same-origin /api prefix with credentials and skips empty query values', async () => {
    const fetchMock = stubFetch(json({ data: [] }));

    await api('/workspaces/w1/tasks', { query: { q: 'a b', status: undefined, page: 2, assigneeId: '' } });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/workspaces/w1/tasks?q=a+b&page=2');
    expect(init?.credentials).toBe('include');
  });

  it('does not parse a body for 204', async () => {
    stubFetch(new Response(null, { status: 204 }));

    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('reports an HTML response as upstream unavailable instead of crashing the JSON parser', async () => {
    stubFetch(new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));

    const error = await caught(api('/workspaces', { method: 'POST', body: { name: 'x' } }));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(UPSTREAM_UNAVAILABLE);
    expect(isOutcomeUnknown(error)).toBe(true);
  });

  it('reports a 200 HTML response as upstream unavailable', async () => {
    stubFetch(new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));

    const error = await caught(api('/workspaces', { method: 'POST', body: {} }));

    expect((error as ApiError).code).toBe(UPSTREAM_UNAVAILABLE);
  });

  it('keeps the business code, requestId and field details of an API error', async () => {
    stubFetch(
      json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid data',
            requestId: 'req-1',
            details: [{ field: 'title', message: 'Title is required' }],
          },
        },
        400,
      ),
    );

    const error = (await caught(api('/x', { method: 'POST', body: {} }))) as ApiError;

    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.requestId).toBe('req-1');
    expect(fieldErrors(error)).toEqual({ title: 'Title is required' });
    expect(isOutcomeUnknown(error)).toBe(false);
  });

  it('retries a GET once after a network failure', async () => {
    const fetchMock = stubFetch(new TypeError('Failed to fetch'), json({ data: 1 }));

    await expect(api('/auth/me')).resolves.toEqual({ data: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a GET once after 503 and then surfaces the error', async () => {
    const unavailable = () => json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'draining', requestId: 'r' } }, 503);
    const fetchMock = stubFetch(unavailable(), unavailable());

    const error = (await caught(api('/auth/me'))) as ApiError;

    expect(error.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never retries a write after a network failure', async () => {
    const fetchMock = stubFetch(new TypeError('Failed to fetch'));

    const error = (await caught(api('/workspaces', { method: 'POST', body: { name: 'x' } }))) as ApiError;

    expect(error.code).toBe(NETWORK_ERROR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates an abort without retrying or wrapping it', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = stubFetch(new DOMException('Aborted', 'AbortError'));

    const error = await caught(api('/auth/me', { signal: controller.signal }));

    expect(isAbortError(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
