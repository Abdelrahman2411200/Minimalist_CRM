import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { noQueryParameters } from '../../middleware/validation.js';
import { serializeOpportunity } from '../serialization.js';
import { idSchema } from '../validation.js';
import { createOpportunitySchema, opportunityQuerySchema, updateOpportunitySchema } from './schema.js';
import { createOpportunity, getOpportunity, listOpportunities, updateOpportunity } from './service.js';

export function opportunitiesRouter(database: PrismaClient) {
  const router = Router();
  router.get('/', async (request, response) => {
    const opportunities = await listOpportunities(database, opportunityQuerySchema.parse(request.query));
    response.json({ data: opportunities.map(serializeOpportunity) });
  });
  router.post('/', noQueryParameters, async (request, response) => {
    const opportunity = await createOpportunity(database, createOpportunitySchema.parse(request.body));
    response.status(201).location(`/api/opportunities/${opportunity.id}`).json({ data: serializeOpportunity(opportunity) });
  });
  router.get('/:id', noQueryParameters, async (request, response) => {
    const opportunity = await getOpportunity(database, idSchema.parse(request.params.id));
    response.json({ data: serializeOpportunity(opportunity) });
  });
  router.patch('/:id', noQueryParameters, async (request, response) => {
    const opportunity = await updateOpportunity(database, idSchema.parse(request.params.id), updateOpportunitySchema.parse(request.body));
    response.json({ data: serializeOpportunity(opportunity) });
  });
  return router;
}
