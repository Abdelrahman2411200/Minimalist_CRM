import type { z } from 'zod';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { ApiError } from '../../middleware/errors.js';
import { toDatabaseStage } from '../leads/stages.js';
import type { contactQuerySchema, createContactSchema, updateContactSchema } from './schema.js';

function escapeSearch(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function listContacts(database: PrismaClient, query: z.infer<typeof contactQuerySchema>) {
  const where: Prisma.ContactWhereInput = {};
  if (query.search) {
    const contains = { contains: escapeSearch(query.search), mode: 'insensitive' as const };
    where.OR = [
      { firstName: contains }, { lastName: contains }, { company: contains }, { email: contains },
      { AND: query.search.split(/\s+/).map((part) => ({
        OR: [
          { firstName: { contains: escapeSearch(part), mode: 'insensitive' as const } },
          { lastName: { contains: escapeSearch(part), mode: 'insensitive' as const } },
        ],
      })) },
    ];
  }
  if (query.source) where.leadSource = { equals: query.source, mode: 'insensitive' };
  if (query.stage) where.lead = { is: { stage: toDatabaseStage(query.stage) } };

  return database.contact.findMany({ where, include: { lead: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
}

export async function getContact(database: PrismaClient, id: string) {
  const contact = await database.contact.findUnique({
    where: { id },
    include: { lead: { include: { opportunities: { orderBy: [{ closeDate: 'asc' }, { id: 'asc' }] } } } },
  });
  if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  return contact;
}

export function createContact(database: PrismaClient, data: z.infer<typeof createContactSchema>) {
  return database.contact.create({ data, include: { lead: true } });
}

export function updateContact(database: PrismaClient, id: string, data: z.infer<typeof updateContactSchema>) {
  return database.contact.update({ where: { id }, data, include: { lead: true } });
}
