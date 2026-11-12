import { z } from 'zod';
import { idSchema, patchSchema } from '../validation.js';
import { stageSchema } from './stages.js';

export const createLeadSchema = z.strictObject({
  contactId: idSchema,
  leadScore: z.number().int().min(1).max(10),
  stage: stageSchema.optional(),
});
export const updateLeadSchema = patchSchema(createLeadSchema);
export const leadQuerySchema = z.strictObject({
  contactId: idSchema.optional(),
  stage: stageSchema.optional(),
});
