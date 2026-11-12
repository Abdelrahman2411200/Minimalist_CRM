import { z } from 'zod';
import { dateSchema, idSchema, moneySchema, patchSchema, requiredText } from '../validation.js';

export const createOpportunitySchema = z.strictObject({
  leadId: idSchema,
  opportunityName: requiredText,
  estimatedValue: moneySchema,
  closeDate: dateSchema,
});
export const updateOpportunitySchema = patchSchema(createOpportunitySchema);
export const opportunityQuerySchema = z.strictObject({ leadId: idSchema.optional() });
