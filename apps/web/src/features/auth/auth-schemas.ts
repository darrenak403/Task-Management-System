import { z } from 'zod';

import { msg } from '@/i18n/messages';

const email = z.string().trim().min(1, msg((m) => m.common.emailRequired)).max(254, msg((m) => m.auth.emailTooLong)).pipe(z.email(msg((m) => m.common.emailInvalid)));

const password = z
  .string()
  .min(8, msg((m) => m.auth.passwordMin))
  .max(128, msg((m) => m.auth.passwordMax));

export const loginSchema = z.object({ email, password });

export const registerSchema = z
  .object({
    displayName: z.string().trim().max(80, msg((m) => m.auth.displayNameMax)),
    email,
    password,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    ...msg((m) => m.auth.passwordMismatch),
  })
  // The API rejects an empty displayName, so an empty optional field is omitted.
  .transform(({ displayName, email, password }) => ({
    email,
    password,
    ...(displayName ? { displayName } : {}),
  }));
