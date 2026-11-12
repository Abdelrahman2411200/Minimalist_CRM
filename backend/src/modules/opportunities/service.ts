import type { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { ApiError } from '../../middleware/errors.js';
import type { createOpportunitySchema, opportunityQuerySchema, updateOpportunitySchema } from './schema.js';

async function requireLead(database: PrismaClient, leadId: string) {
  const lead = await database.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) throw new ApiError(404, 'PARENT_NOT_FOUND', 'Lead not found');
}

export function listOpportunities(database: PrismaClient, query: z.infer<typeof opportunityQuerySchema>) {
  return database.opportunity.findMany({
    where: { leadId: query.leadId },
    orderBy: [{ closeDate: 'asc' }, { id: 'asc' }],
  });
}

export async function getOpportunity(database: PrismaClient, id: string) {
  const opportunity = await database.opportunity.findUnique({ where: { id } });
  if (!opportunity) throw new ApiError(404, 'NOT_FOUND', 'Opportunity not found');
  return opportunity;
}

export async function createOpportunity(database: PrismaClient, data: z.infer<typeof createOpportunitySchema>) {
  await requireLead(database, data.leadId);
  return database.opportunity.create({ data: { ...data, closeDate: new Date(`${data.closeDate}T00:00:00.000Z`) } });
}

export async function updateOpportunity(database: PrismaClient, id: string, data: z.infer<typeof updateOpportunitySchema>) {
  await getOpportunity(database, id);
  if (data.leadId) await requireLead(database, data.leadId);
  return database.opportunity.update({
    where: { id },
    data: { ...data, closeDate: data.closeDate ? new Date(`${data.closeDate}T00:00:00.000Z`) : undefined },
  });
}
