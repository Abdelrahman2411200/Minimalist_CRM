import { LeadStage } from '../src/generated/prisma/enums.js';

// Fictional companies and reserved .test addresses. Stable IDs make reseeding repeatable.
export const syntheticContacts = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    firstName: 'Mariam',
    lastName: 'Example',
    email: 'mariam@example.test',
    phone: null,
    company: 'Synthetic Nile Studio',
    leadSource: 'Website Form',
    notes: 'Fictional fixture. Interested in a website project.',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    firstName: 'Omar',
    lastName: 'Sample',
    email: 'omar@example.test',
    phone: null,
    company: 'Synthetic Delta Works',
    leadSource: 'Referral',
    notes: 'Fictional fixture with two potential deals.',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    firstName: 'Nour',
    lastName: 'Demo',
    email: 'nour@example.test',
    phone: null,
    company: 'Synthetic Cairo Lab',
    leadSource: 'Event',
    notes: null,
  },
];

export const syntheticLeads = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    contactId: syntheticContacts[0]!.id,
    leadScore: 7,
    stage: LeadStage.Qualification,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    contactId: syntheticContacts[1]!.id,
    leadScore: 9,
    stage: LeadStage.Negotiation,
  },
];

export const syntheticOpportunities = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    leadId: syntheticLeads[0]!.id,
    opportunityName: 'Synthetic website project',
    estimatedValue: '30000.25',
    closeDate: new Date('2027-01-15T00:00:00.000Z'),
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    leadId: syntheticLeads[1]!.id,
    opportunityName: 'Synthetic support agreement',
    estimatedValue: '12000.00',
    closeDate: new Date('2027-02-28T00:00:00.000Z'),
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    leadId: syntheticLeads[1]!.id,
    opportunityName: 'Synthetic discovery session',
    estimatedValue: '0.00',
    closeDate: new Date('2027-03-01T00:00:00.000Z'),
  },
];
