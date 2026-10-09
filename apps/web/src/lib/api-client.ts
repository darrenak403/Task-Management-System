import { ApiError, NETWORK_ERROR, UPSTREAM_UNAVAILABLE, isAbortError, type ApiFieldError } from './api-errors';

type QueryValue = string | number | boolean | null | undefined;

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal | undefined;
};

const API_PREFIX = '/api';

function buildUrl(path: string, query: ApiRequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return `${API_PREFIX}${path}${search ? `?${search}` : ''}`;
}

function isJson(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('application/json');
}

async function toApiError(response: Response): Promise<ApiError> {
  // A proxy or tunnel answers with HTML/text when the API itself is unreachable.
  if (!isJson(response)) {
    return new ApiError({
      status: response.status,
      code: UPSTREAM_UNAVAILABLE,
      message: 'The service is temporarily unavailable.',
    });
  }
  try {
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; requestId?: string; details?: ApiFieldError[] };
    };
    return new ApiError({
      status: response.status,
      code: payload.error?.code ?? 'UNKNOWN_ERROR',
      message: payload.error?.message ?? 'Request failed.',
      requestId: payload.error?.requestId,
      details: Array.isArray(payload.error?.details) ? payload.error.details : undefined,
    });
  } catch {
    return new ApiError({ status: response.status, code: UPSTREAM_UNAVAILABLE, message: 'Unreadable server response.' });
  }
}

async function send<T>(path: string, options: ApiRequestOptions): Promise<T> {
  const method = options.method ?? 'GET';
  const init: RequestInit = { method, credentials: 'include', headers: { Accept: 'application/json' } };
  if (options.signal) init.signal = options.signal;
  if (options.body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError({ status: 0, code: NETWORK_ERROR, message: 'Network request failed.' });
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  if (!isJson(response)) {
    throw new ApiError({
      status: response.status,
      code: UPSTREAM_UNAVAILABLE,
      message: 'The service returned an unexpected response.',
    });
  }
  return (await response.json()) as T;
}

type SessionListener = () => void;
const sessionExpiredListeners = new Set<SessionListener>();

/** Lets the auth provider react when any request finds the session missing or expired. */
export function onSessionExpired(listener: SessionListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

function notifyIfSessionExpired(error: unknown): void {
  // INVALID_CREDENTIALS is also a 401 but belongs to the login form, not to an existing session.
  if (error instanceof ApiError && error.status === 401 && error.code === 'UNAUTHENTICATED') {
    for (const listener of sessionExpiredListeners) listener();
  }
}

function isRetryable(error: unknown): boolean {
  return error instanceof ApiError && (error.code === NETWORK_ERROR || error.status === 503);
}

/**
 * The single HTTP path of the app: same-origin fetch with the session cookie.
 * Reads are retried once on a network failure or 503. Writes are never retried,
 * because a lost response does not tell whether the server committed.
 */
export async function api<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  try {
    return await send<T>(path, options);
  } catch (error) {
    if (method === 'GET' && isRetryable(error) && !options.signal?.aborted) {
      try {
        return await send<T>(path, options);
      } catch (retryError) {
        notifyIfSessionExpired(retryError);
        throw retryError;
      }
    }
    notifyIfSessionExpired(error);
    throw error;
  }
}
