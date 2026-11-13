import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDemoData } from '../src/data/demo';
import { CrmError } from '../src/data/errors';
import type { ContactInput, LeadInput, OpportunityInput } from '../src/data/types';
import { formatDate, formatMoney } from '../src/format';

const contactInput: ContactInput = {
  firstName: 'Sara', lastName: 'Example', email: 'sara@example.test', company: 'Synthetic Sample Company', leadSource: 'Website Form',
};

async function rejects(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => error instanceof CrmError && error.status === status);
}

test('demo supports contact-to-opportunity workflow and preserves omitted edits', async () => {
  const crm = createDemoData();
  const contact = await crm.createContact({ ...contactInput, firstName: ' Sara ', phone: '', notes: 'Line one\nLine two' });
  assert.equal(contact.firstName, 'Sara');
  assert.equal(contact.phone, null);
  assert.equal(contact.lead, null);
  const lead = await crm.createLead({ contactId: contact.id, leadScore: 7 });
  assert.equal(lead.stage, 'Prospecting');
  await crm.updateLead(lead.id, { stage: 'Closed Won' });
  const scored = await crm.updateLead(lead.id, { leadScore: 9 });
  assert.equal(scored.stage, 'Closed Won');
  const opportunity = await crm.createOpportunity({ leadId: lead.id, opportunityName: 'Synthetic deal', estimatedValue: '30000.2', closeDate: '2028-02-29' });
  assert.equal(opportunity.estimatedValue, '30000.20');
  const edited = await crm.updateOpportunity(opportunity.id, { opportunityName: 'Edited synthetic deal' });
  assert.equal(edited.closeDate, '2028-02-29');
  assert.equal(edited.estimatedValue, '30000.20');
  await crm.updateContact(contact.id, { company: 'Updated company', phone: undefined });
  const detail = await crm.getContact(contact.id);
  assert.equal(detail.notes, 'Line one\nLine two');
  assert.equal(detail.phone, null);
  assert.equal(detail.lead?.opportunities[0]?.opportunityName, 'Edited synthetic deal');
  assert.equal((await crm.listLeads({ contactId: contact.id }))[0]?.contact.company, 'Updated company');
  assert.equal((await crm.listOpportunities({ leadId: lead.id })).length, 1);
});

test('demo filtering matches name parts, company, email, source, stage, and literal search', async () => {
  const crm = createDemoData();
  const contact = await crm.createContact({ ...contactInput, company: 'Synthetic 100%_Company' });
  await crm.createLead({ contactId: contact.id, leadScore: 7, stage: 'Qualification' });
  for (const search of ['SARA EXAMPLE', 'example sara', '100%_', 'sara@example.test']) {
    const matches = await crm.listContacts({ search, source: 'website form', stage: 'Qualification' });
    assert.deepEqual(matches.map((record) => record.id), [contact.id]);
  }
  assert.equal((await crm.listContacts({ search: '%' })).length, 1);
  assert.ok((await crm.listContacts()).some((record) => record.lead === null));
  assert.ok((await crm.listContacts({ stage: 'Qualification' })).every((record) => record.lead?.stage === 'Qualification'));
  await rejects(crm.listContacts({ stage: 'Unknown' } as never), 400);
  await rejects(crm.listContacts({ unexpected: 'value' } as never), 400);
});

test('demo enforces foreign keys and one lead per contact, including concurrent requests', async () => {
  const crm = createDemoData();
  await rejects(crm.createLead({ contactId: randomUUID(), leadScore: 5 }), 404);
  const parent = await crm.createContact(contactInput);
  const attempts = await Promise.allSettled([
    crm.createLead({ contactId: parent.id, leadScore: 5 }),
    crm.createLead({ contactId: parent.id, leadScore: 6 }),
  ]);
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  const failed = attempts.find((result) => result.status === 'rejected');
  assert.ok(failed?.status === 'rejected' && failed.reason instanceof CrmError && failed.reason.status === 409);
  const lead = (await crm.getContact(parent.id)).lead!;
  await rejects(crm.updateLead(lead.id, { contactId: randomUUID(), leadScore: 10 }), 404);
  assert.equal((await crm.getLead(lead.id)).leadScore, 5);
  await rejects(crm.createOpportunity({ leadId: randomUUID(), opportunityName: 'Missing parent', estimatedValue: '1', closeDate: '2028-01-01' }), 404);
  const opportunity = await crm.createOpportunity({ leadId: lead.id, opportunityName: 'Test', estimatedValue: '1', closeDate: '2028-01-01' });
  await rejects(crm.updateOpportunity(opportunity.id, { leadId: randomUUID(), estimatedValue: '2' }), 404);
  assert.equal((await crm.getOpportunity(opportunity.id)).estimatedValue, '1.00');
});

test('demo validates required fields, manual scores, money, dates, and body size', async () => {
  const crm = createDemoData();
  await rejects(crm.createContact({ ...contactInput, email: 'invalid' }), 400);
  await rejects(crm.createContact({ ...contactInput, company: ' ' }), 400);
  await rejects(crm.createContact({ ...contactInput, notes: 'x'.repeat(110_000) }), 413);
  const parent = await crm.createContact(contactInput);
  await rejects(crm.updateContact(parent.id, {}), 400);
  await rejects(crm.updateContact(parent.id, { phone: undefined }), 400);
  for (const leadScore of [0, 11, 1.5, '7']) {
    await rejects(crm.createLead({ contactId: parent.id, leadScore } as LeadInput), 400);
  }
  const lead = await crm.createLead({ contactId: parent.id, leadScore: 5 });
  const input: OpportunityInput = { leadId: lead.id, opportunityName: 'Test', estimatedValue: '1', closeDate: '2028-01-01' };
  for (const estimatedValue of ['-0.01', 'NaN', '1e3', '01.00', '1.234', '1000000000000.00', 3]) {
    await rejects(crm.createOpportunity({ ...input, estimatedValue } as OpportunityInput), 400);
  }
  for (const closeDate of ['2027-02-29', '0000-01-01', '2028-01-01T00:00:00Z', '2028-13-01']) {
    await rejects(crm.createOpportunity({ ...input, closeDate }), 400);
  }
  for (const closeDate of ['0001-01-01', '2028-02-29', '9999-12-31']) {
    const created = await crm.createOpportunity({ ...input, closeDate, estimatedValue: '999999999999.99' });
    assert.equal(created.closeDate, closeDate);
    assert.equal(created.estimatedValue, '999999999999.99');
  }
  await rejects(crm.getContact('invalid'), 400);
  await rejects(crm.getContact(randomUUID()), 404);
});

test('demo data is isolated, returns copies, and resets in a new instance', async () => {
  const first = createDemoData();
  const contacts = await first.listContacts();
  contacts[0]!.firstName = 'Changed copy';
  assert.ok(!(await first.listContacts()).some((record) => record.firstName === 'Changed copy'));
  await first.createContact(contactInput);
  assert.equal((await first.listContacts()).length, 4);
  assert.equal((await createDemoData().listContacts()).length, 3);
});

test('display formatting preserves EGP minor units and date-only values', () => {
  assert.equal(formatMoney('999999999999.99'), 'EGP 999,999,999,999.99');
  assert.equal(formatMoney('0.00'), 'EGP 0.00');
  assert.equal(formatDate('2028-02-29'), '29 Feb 2028');
});
