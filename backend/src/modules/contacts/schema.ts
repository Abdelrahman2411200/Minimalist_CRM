import { z } from 'zod';
import { patchSchema, requiredText } from '../validation.js';
import { stageSchema } from '../leads/stages.js';

export const createContactSchema = z.strictObject({
  firstName: requiredText,
  lastName: requiredText,
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(50).transform((value) => value || null).nullable().optional(),
  company: requiredText,
  leadSource: requiredText,
  notes: z.string().nullable().optional(),
});

export const updateContactSchema = patchSchema(createContactSchema);
export const contactQuerySchema = z.strictObject({
  search: z.string().trim().max(200).optional(),
  source: requiredText.optional(),
  stage: stageSchema.optional(),
});
