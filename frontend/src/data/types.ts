import type { z } from 'zod';
import type { createContactSchema, contactQuerySchema } from '../../../backend/src/modules/contacts/schema';
import type { createLeadSchema, leadQuerySchema } from '../../../backend/src/modules/leads/schema';
import type { createOpportunitySchema, opportunityQuerySchema } from '../../../backend/src/modules/opportunities/schema';
import type { stageSchema } from '../../../backend/src/modules/leads/stages';

export type Stage = z.infer<typeof stageSchema>;
export type ContactInput = z.infer<typeof createContactSchema>;
export type LeadInput = z.infer<typeof createLeadSchema>;
export type OpportunityInput = z.infer<typeof createOpportunitySchema>;
export type ContactQuery = z.infer<typeof contactQuerySchema>;
export type LeadQuery = z.infer<typeof leadQuerySchema>;
export type OpportunityQuery = z.infer<typeof opportunityQuerySchema>;
export type User = { id: string; username: string };
type RecordDates = { id: string; createdAt: string; updatedAt: string };
export type Contact = RecordDates & Omit<ContactInput, 'phone' | 'notes'> & { phone: string | null; notes: string | null };
export type Lead = RecordDates & Omit<LeadInput, 'stage'> & { stage: Stage };
export type Opportunity = RecordDates & OpportunityInput;
export type ContactSummary = Contact & { lead: Lead | null };
export type ContactDetail = Contact & { lead: (Lead & { opportunities: Opportunity[] }) | null };
export type LeadDetail = Lead & { contact: Contact; opportunities: Opportunity[] };

export interface CrmData {
  kind: 'full' | 'demo';
  me(signal?: AbortSignal): Promise<User | null>;
  login(username: string, password: string): Promise<User>;
  logout(): Promise<void>;
  listContacts(query?: ContactQuery, signal?: AbortSignal): Promise<ContactSummary[]>;
  getContact(id: string, signal?: AbortSignal): Promise<ContactDetail>;
  createContact(input: ContactInput): Promise<ContactSummary>;
  updateContact(id: string, input: Partial<ContactInput>): Promise<ContactSummary>;
  listLeads(query?: LeadQuery, signal?: AbortSignal): Promise<LeadDetail[]>;
  getLead(id: string, signal?: AbortSignal): Promise<LeadDetail>;
  createLead(input: LeadInput): Promise<LeadDetail>;
  updateLead(id: string, input: Partial<LeadInput>): Promise<LeadDetail>;
  listOpportunities(query?: OpportunityQuery, signal?: AbortSignal): Promise<Opportunity[]>;
  getOpportunity(id: string, signal?: AbortSignal): Promise<Opportunity>;
  createOpportunity(input: OpportunityInput): Promise<Opportunity>;
  updateOpportunity(id: string, input: Partial<OpportunityInput>): Promise<Opportunity>;
}
