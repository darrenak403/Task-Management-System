import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(8).max(128),
    displayName: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(8).max(128),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
