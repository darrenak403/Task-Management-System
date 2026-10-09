import { messages } from '@/i18n/messages';

export type ApiFieldError = { field: string; message: string };

/** Transport-level codes produced by the client itself; every other code comes from the API envelope. */
export const NETWORK_ERROR = 'NETWORK_ERROR';
export const UPSTREAM_UNAVAILABLE = 'UPSTREAM_UNAVAILABLE';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: ApiFieldError[];

  constructor(input: {
    status: number;
    code: string;
    message: string;
    requestId?: string | undefined;
    details?: ApiFieldError[] | undefined;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId;
    this.details = input.details ?? [];
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isAbortError(error: unknown): boolean {
  // Checked by name: the DOMException class differs between realms, so `instanceof` is unreliable.
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

/** The request may or may not have reached the server, so a write's outcome is unknown. */
export function isOutcomeUnknown(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.code === NETWORK_ERROR || error.code === UPSTREAM_UNAVAILABLE || error.status === 503)
  );
}

export function isUnauthenticated(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

/** Access to the scope was removed or never existed; cached data for it must be dropped. */
export function isAccessLost(error: unknown): boolean {
  return isApiError(error) && (error.status === 403 || error.status === 404);
}

export function fieldErrors(error: unknown): Record<string, string> {
  if (!isApiError(error)) return {};
  const result: Record<string, string> = {};
  for (const detail of error.details) {
    result[detail.field] ??= detail.message;
  }
  return result;
}

export function errorMessage(error: unknown, fallback?: string): string {
  const text = messages().common.errors;
  if (isApiError(error)) {
    if (error.code === NETWORK_ERROR) return text.network;
    if (error.code === UPSTREAM_UNAVAILABLE || error.status === 503) {
      return text.unavailable;
    }
    return text.byCode[error.code] ?? (error.message || fallback || text.generic);
  }
  return fallback ?? text.generic;
}
