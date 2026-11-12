import type { Contact, Lead, Opportunity } from '../generated/prisma/client.js';
import { toApiStage } from './leads/stages.js';

export function serializeContact(contact: Contact) {
  return {
    ...contact,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

export function serializeLead(lead: Lead) {
  return {
    id: lead.id,
    contactId: lead.contactId,
    leadScore: lead.leadScore,
    stage: toApiStage(lead.stage),
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

export function serializeOpportunity(opportunity: Opportunity) {
  return {
    ...opportunity,
    estimatedValue: opportunity.estimatedValue.toFixed(2),
    closeDate: opportunity.closeDate.toISOString().slice(0, 10),
    createdAt: opportunity.createdAt.toISOString(),
    updatedAt: opportunity.updatedAt.toISOString(),
  };
}

export function serializeContactSummary(contact: Contact & { lead: Lead | null }) {
  return { ...serializeContact(contact), lead: contact.lead ? serializeLead(contact.lead) : null };
}

export function serializeContactDetail(contact: Contact & { lead: (Lead & { opportunities: Opportunity[] }) | null }) {
  return {
    ...serializeContact(contact),
    lead: contact.lead ? {
      ...serializeLead(contact.lead),
      opportunities: contact.lead.opportunities.map(serializeOpportunity),
    } : null,
  };
}

export function serializeLeadDetail(lead: Lead & { contact: Contact; opportunities: Opportunity[] }) {
  return {
    ...serializeLead(lead),
    contact: serializeContact(lead.contact),
    opportunities: lead.opportunities.map(serializeOpportunity),
  };
}
