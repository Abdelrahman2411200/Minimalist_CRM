import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { noQueryParameters } from '../../middleware/validation.js';
import { serializeContactDetail, serializeContactSummary } from '../serialization.js';
import { idSchema } from '../validation.js';
import { contactQuerySchema, createContactSchema, updateContactSchema } from './schema.js';
import { createContact, getContact, listContacts, updateContact } from './service.js';

export function contactsRouter(database: PrismaClient) {
  const router = Router();
  router.get('/', async (request, response) => {
    const contacts = await listContacts(database, contactQuerySchema.parse(request.query));
    response.json({ data: contacts.map(serializeContactSummary) });
  });
  router.post('/', noQueryParameters, async (request, response) => {
    const contact = await createContact(database, createContactSchema.parse(request.body));
    response.status(201).location(`/api/contacts/${contact.id}`).json({ data: serializeContactSummary(contact) });
  });
  router.get('/:id', noQueryParameters, async (request, response) => {
    const contact = await getContact(database, idSchema.parse(request.params.id));
    response.json({ data: serializeContactDetail(contact) });
  });
  router.patch('/:id', noQueryParameters, async (request, response) => {
    const contact = await updateContact(database, idSchema.parse(request.params.id), updateContactSchema.parse(request.body));
    response.json({ data: serializeContactSummary(contact) });
  });
  return router;
}
