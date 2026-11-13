import type { Contact, Lead, Opportunity } from './types';

const timestamps = { createdAt: '2026-11-01T09:00:00.000Z', updatedAt: '2026-11-01T09:00:00.000Z' };

export const fixtureContacts: Contact[] = [
  { ...timestamps, id: '10000000-0000-4000-8000-000000000001', firstName: 'Mariam', lastName: 'Example', email: 'mariam@example.test', phone: null, company: 'Synthetic Nile Studio', leadSource: 'Website Form', notes: 'Fictional inquiry about a website project.' },
  { ...timestamps, id: '10000000-0000-4000-8000-000000000002', firstName: 'Omar', lastName: 'Sample', email: 'omar@example.test', phone: null, company: 'Synthetic Delta Works', leadSource: 'Referral', notes: 'Fictional prospect with two opportunities.' },
  { ...timestamps, id: '10000000-0000-4000-8000-000000000003', firstName: 'Nour', lastName: 'Demo', email: 'nour@example.test', phone: null, company: 'Synthetic Cairo Lab', leadSource: 'Event', notes: null },
];
export const fixtureLeads: Lead[] = [
  { ...timestamps, id: '20000000-0000-4000-8000-000000000001', contactId: fixtureContacts[0]!.id, leadScore: 7, stage: 'Qualification' },
  { ...timestamps, id: '20000000-0000-4000-8000-000000000002', contactId: fixtureContacts[1]!.id, leadScore: 9, stage: 'Negotiation' },
];
export const fixtureOpportunities: Opportunity[] = [
  { ...timestamps, id: '30000000-0000-4000-8000-000000000001', leadId: fixtureLeads[0]!.id, opportunityName: 'Synthetic website project', estimatedValue: '30000.25', closeDate: '2027-01-15' },
  { ...timestamps, id: '30000000-0000-4000-8000-000000000002', leadId: fixtureLeads[1]!.id, opportunityName: 'Synthetic support agreement', estimatedValue: '12000.00', closeDate: '2027-02-28' },
  { ...timestamps, id: '30000000-0000-4000-8000-000000000003', leadId: fixtureLeads[1]!.id, opportunityName: 'Synthetic discovery session', estimatedValue: '0.00', closeDate: '2027-03-01' },
];
