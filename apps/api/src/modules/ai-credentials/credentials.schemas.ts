import { z } from 'zod';

const geminiModelSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);

export const putGeminiCredentialSchema = z
  .object({
    key: z.string().min(20).max(512).refine((value) => value.trim() === value && !/\s/.test(value)),
    model: geminiModelSchema,
  })
  .strict();

export const updateGeminiModelSchema = z.object({ model: geminiModelSchema }).strict();

export type PutGeminiCredentialInput = z.infer<typeof putGeminiCredentialSchema>;
export type UpdateGeminiModelInput = z.infer<typeof updateGeminiModelSchema>;
