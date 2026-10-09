import { z } from 'zod';
import { HttpError } from './error-handler.js';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(2_147_483_647).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export type PaginationInput = z.infer<typeof paginationSchema>;

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The request is invalid.');
  return result.data;
}

export function paginationOffset(pagination: PaginationInput): number {
  return (pagination.page - 1) * pagination.pageSize;
}

export function pageMeta(pagination: PaginationInput, total: number) {
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pagination.pageSize),
  };
}
