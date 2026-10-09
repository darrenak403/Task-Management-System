import type { z } from 'zod';

export type FieldErrors = Record<string, string>;

export type Validation<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

/** Runs a Zod schema and keeps the first message per top-level field. */
export function validate<S extends z.ZodType>(schema: S, values: unknown): Validation<z.output<S>> {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? 'form');
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}
