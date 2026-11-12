import { z } from 'zod';

export const usernameSchema = z.string().trim().min(3).max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Use letters, digits, dots, underscores, or hyphens')
  .transform((value) => value.toLowerCase());

export const newPasswordSchema = z.string().min(12).max(128)
  .refine((value) => !/[\r\n\0]/.test(value), 'Password contains unsupported control characters');

export const loginSchema = z.strictObject({
  username: usernameSchema,
  password: z.string().min(1).max(128),
});
