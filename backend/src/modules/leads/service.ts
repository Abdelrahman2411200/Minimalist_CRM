import type { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { ApiError } from '../../middleware/errors.js';
import { toDatabaseStage } from './stages.js';
import type { createLeadSchema, leadQuerySchema, updateLeadSchema } from './schema.js';

const relations = { contact: true, opportunities: { orderBy: { closeDate: 'asc' as const } } } as const;

async function requireContact(database: PrismaClient, contactId: string) {
  const contact = await database.contact.findUnique({ where: { id: contactId }, select: { id: true } });
  if (!contact) throw new ApiError(404, 'PARENT_NOT_FOUND', 'Contact not found');
}

export function listLeads(database: PrismaClient, query: z.infer<typeof leadQuerySchema>) {
  return database.lead.findMany({
    where: { contactId: query.contactId, stage: query.stage ? toDatabaseStage(query.stage) : undefined },
    include: relations,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
}

export async function getLead(database: PrismaClient, id: string) {
  const lead = await database.lead.findUnique({ where: { id }, include: relations });
  if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead not found');
  return lead;
}

export async function createLead(database: PrismaClient, data: z.infer<typeof createLeadSchema>) {
  await requireContact(database, data.contactId);
  return database.lead.create({
    data: { ...data, stage: data.stage ? toDatabaseStage(data.stage) : 'Prospecting' },
    include: relations,
  });
}

export async function updateLead(database: PrismaClient, id: string, data: z.infer<typeof updateLeadSchema>) {
  await getLead(database, id);
  if (data.contactId) await requireContact(database, data.contactId);
  return database.lead.update({
    where: { id },
    data: { ...data, stage: data.stage ? toDatabaseStage(data.stage) : undefined },
    include: relations,
  });
}
