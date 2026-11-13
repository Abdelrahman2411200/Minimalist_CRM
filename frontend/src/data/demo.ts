import type { z } from 'zod';
import { createContactSchema, updateContactSchema, contactQuerySchema } from '../../../backend/src/modules/contacts/schema';
import { createLeadSchema, updateLeadSchema, leadQuerySchema } from '../../../backend/src/modules/leads/schema';
import { createOpportunitySchema, updateOpportunitySchema, opportunityQuerySchema } from '../../../backend/src/modules/opportunities/schema';
import { idSchema } from '../../../backend/src/modules/validation';
import { CrmError, validationError } from './errors';
import { fixtureContacts, fixtureLeads, fixtureOpportunities } from './fixtures';
import type { Contact, CrmData, Lead } from './types';

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

function money(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

function parseBody<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const json = JSON.stringify(input);
  if (json && new TextEncoder().encode(json).length > 100 * 1024) {
    throw new CrmError(413, 'BODY_TOO_LARGE', 'The request body exceeds 100 KB');
  }
  return parse(schema, json === undefined ? undefined : JSON.parse(json));
}

export function createDemoData(): CrmData {
  const contacts = new Map(structuredClone(fixtureContacts).map((record) => [record.id, record]));
  const leads = new Map(structuredClone(fixtureLeads).map((record) => [record.id, record]));
  const opportunities = new Map(structuredClone(fixtureOpportunities).map((record) => [record.id, record]));
  const user = { id: 'demo', username: 'Demo workspace' };

  function find<T>(records: Map<string, T>, id: string, label: string) {
    parse(idSchema, id);
    const record = records.get(id);
    if (!record) throw new CrmError(404, 'NOT_FOUND', `${label} not found`);
    return record;
  }
  function contactLead(contactId: string) {
    return [...leads.values()].find((lead) => lead.contactId === contactId) ?? null;
  }
  function leadOpportunities(leadId: string) {
    return [...opportunities.values()].filter((opportunity) => opportunity.leadId === leadId)
      .sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.id.localeCompare(b.id));
  }
  function leadDetail(lead: Lead) {
    return { ...lead, contact: find(contacts, lead.contactId, 'Contact'), opportunities: leadOpportunities(lead.id) };
  }
  function requireParent<T>(records: Map<string, T>, id: string, label: string) {
    if (!records.has(id)) throw new CrmError(404, 'PARENT_NOT_FOUND', `${label} not found`);
  }
  function requireUniqueLead(contactId: string, exceptId?: string) {
    if ([...leads.values()].some((lead) => lead.contactId === contactId && lead.id !== exceptId)) {
      throw new CrmError(409, 'CONFLICT', 'This contact already has a lead');
    }
  }
  function newRecord() {
    const timestamp = new Date().toISOString();
    return { id: crypto.randomUUID(), createdAt: timestamp, updatedAt: timestamp };
  }
  const newestFirst = (a: Contact | Lead, b: Contact | Lead) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

  return {
    kind: 'demo',
    async me() { return { ...user }; },
    async login() { return { ...user }; },
    async logout() {},
    async listContacts(input = {}) {
      const query = parse(contactQuerySchema, input);
      const search = query.search?.toLowerCase();
      const records = [...contacts.values()].filter((contact) => {
        if (query.source && contact.leadSource.toLowerCase() !== query.source.toLowerCase()) return false;
        if (query.stage && contactLead(contact.id)?.stage !== query.stage) return false;
        if (!search) return true;
        const names = [contact.firstName.toLowerCase(), contact.lastName.toLowerCase()];
        return [...names, contact.company.toLowerCase(), contact.email.toLowerCase()].some((value) => value.includes(search))
          || search.split(/\s+/).every((part) => names.some((value) => value.includes(part)));
      }).sort(newestFirst).map((contact) => ({ ...contact, lead: contactLead(contact.id) }));
      return structuredClone(records);
    },
    async getContact(id) {
      const contact = find(contacts, id, 'Contact');
      const lead = contactLead(id);
      return structuredClone({ ...contact, lead: lead ? { ...lead, opportunities: leadOpportunities(lead.id) } : null });
    },
    async createContact(input) {
      const data = parseBody(createContactSchema, input);
      const contact: Contact = { ...data, phone: data.phone ?? null, notes: data.notes ?? null, ...newRecord() };
      contacts.set(contact.id, contact);
      return structuredClone({ ...contact, lead: null });
    },
    async updateContact(id, input) {
      const data = parseBody(updateContactSchema, input);
      const contact = find(contacts, id, 'Contact');
      const updated = { ...contact, ...data, updatedAt: new Date().toISOString() };
      contacts.set(id, updated);
      return structuredClone({ ...updated, lead: contactLead(id) });
    },
    async listLeads(input = {}) {
      const query = parse(leadQuerySchema, input);
      return structuredClone([...leads.values()].filter((lead) => (!query.contactId || lead.contactId === query.contactId)
        && (!query.stage || lead.stage === query.stage)).sort(newestFirst).map(leadDetail));
    },
    async getLead(id) { return structuredClone(leadDetail(find(leads, id, 'Lead'))); },
    async createLead(input) {
      const data = parseBody(createLeadSchema, input);
      requireParent(contacts, data.contactId, 'Contact');
      requireUniqueLead(data.contactId);
      const lead: Lead = { ...data, stage: data.stage ?? 'Prospecting', ...newRecord() };
      leads.set(lead.id, lead);
      return structuredClone(leadDetail(lead));
    },
    async updateLead(id, input) {
      const data = parseBody(updateLeadSchema, input);
      const lead = find(leads, id, 'Lead');
      if (data.contactId) {
        requireParent(contacts, data.contactId, 'Contact');
        requireUniqueLead(data.contactId, id);
      }
      const updated = { ...lead, ...data, updatedAt: new Date().toISOString() };
      leads.set(id, updated);
      return structuredClone(leadDetail(updated));
    },
    async listOpportunities(input = {}) {
      const query = parse(opportunityQuerySchema, input);
      return structuredClone([...opportunities.values()].filter((record) => !query.leadId || record.leadId === query.leadId)
        .sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.id.localeCompare(b.id)));
    },
    async getOpportunity(id) { return structuredClone(find(opportunities, id, 'Opportunity')); },
    async createOpportunity(input) {
      const data = parseBody(createOpportunitySchema, input);
      requireParent(leads, data.leadId, 'Lead');
      const opportunity = { ...data, estimatedValue: money(data.estimatedValue), ...newRecord() };
      opportunities.set(opportunity.id, opportunity);
      return structuredClone(opportunity);
    },
    async updateOpportunity(id, input) {
      const data = parseBody(updateOpportunitySchema, input);
      const opportunity = find(opportunities, id, 'Opportunity');
      if (data.leadId) requireParent(leads, data.leadId, 'Lead');
      const updated = { ...opportunity, ...data, estimatedValue: data.estimatedValue === undefined ? opportunity.estimatedValue : money(data.estimatedValue), updatedAt: new Date().toISOString() };
      opportunities.set(id, updated);
      return structuredClone(updated);
    },
  };
}

export const crm = createDemoData();
