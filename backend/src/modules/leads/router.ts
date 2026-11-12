import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { noQueryParameters } from '../../middleware/validation.js';
import { serializeLeadDetail } from '../serialization.js';
import { idSchema } from '../validation.js';
import { createLeadSchema, leadQuerySchema, updateLeadSchema } from './schema.js';
import { createLead, getLead, listLeads, updateLead } from './service.js';

export function leadsRouter(database: PrismaClient) {
  const router = Router();
  router.get('/', async (request, response) => {
    const leads = await listLeads(database, leadQuerySchema.parse(request.query));
    response.json({ data: leads.map(serializeLeadDetail) });
  });
  router.post('/', noQueryParameters, async (request, response) => {
    const lead = await createLead(database, createLeadSchema.parse(request.body));
    response.status(201).location(`/api/leads/${lead.id}`).json({ data: serializeLeadDetail(lead) });
  });
  router.get('/:id', noQueryParameters, async (request, response) => {
    const lead = await getLead(database, idSchema.parse(request.params.id));
    response.json({ data: serializeLeadDetail(lead) });
  });
  router.patch('/:id', noQueryParameters, async (request, response) => {
    const lead = await updateLead(database, idSchema.parse(request.params.id), updateLeadSchema.parse(request.body));
    response.json({ data: serializeLeadDetail(lead) });
  });
  return router;
}
