import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { crm } from '@crm-data';
import { createLeadSchema } from '../../../backend/src/modules/leads/schema';
import { stageSchema } from '../../../backend/src/modules/leads/stages';
import { Empty, Failure, Field, Loading, PageHeader, RecordForm, StageBadge } from '../components/common';
import type { ContactSummary, LeadDetail, LeadInput } from '../data/types';
import { changedFields, useSave } from '../hooks';
import { OpportunitiesTable } from './opportunities';

export function LeadsPage() {
  const query = useQuery({ queryKey: ['leads', 'all'], queryFn: ({ signal }) => crm.listLeads({}, signal) });
  return <>
    <PageHeader title="Leads"><Link className="button" to="/leads/new">Qualify lead</Link></PageHeader>
    {query.isError && <Failure error={query.error} retry={() => { void query.refetch(); }} />}
    {!query.data ? !query.isError && <Loading /> : query.data.length === 0 ? <Empty title="No leads yet"><p>Qualify a contact with a manual score to start tracking a lead.</p><Link className="button secondary" to="/leads/new">Qualify lead</Link></Empty> : <>
      <p className="result-count">{query.data.length} leads</p><div className="panel table-wrap"><table><caption className="sr-only">Leads</caption>
        <thead><tr><th scope="col">Contact</th><th scope="col">Company</th><th scope="col">Manual score</th><th scope="col">Stage</th><th scope="col">Opportunities</th></tr></thead>
        <tbody>{query.data.map((lead) => <tr key={lead.id}><td><Link className="record-link" to={`/leads/${lead.id}`}>{lead.contact.firstName} {lead.contact.lastName}</Link></td><td>{lead.contact.company}</td><td>{lead.leadScore} / 10</td><td><StageBadge stage={lead.stage} /></td><td>{lead.opportunities.length}</td></tr>)}</tbody>
      </table></div>
    </>}
  </>;
}

export function LeadPage() {
  const { id = '' } = useParams();
  const query = useQuery({ queryKey: ['leads', id], queryFn: ({ signal }) => crm.getLead(id, signal) });
  if (!query.data) return query.isError ? <Failure error={query.error} retry={() => { void query.refetch(); }} /> : <Loading />;
  const lead = query.data;
  return <>
    <PageHeader title={`${lead.contact.firstName} ${lead.contact.lastName}`} back={{ to: '/leads', label: 'Leads' }}>
      <Link className="button secondary" to={`/leads/${id}/edit`}>Edit lead</Link><Link className="button" to={`/opportunities/new?leadId=${id}`}>Add opportunity</Link>
    </PageHeader>
    <section className="panel detail-panel" aria-label="Lead details"><StageBadge stage={lead.stage} />
      <dl className="horizontal-details"><div><dt>Manual score</dt><dd>{lead.leadScore} / 10</dd></div><div><dt>Company</dt><dd>{lead.contact.company}</dd></div><div><dt>Contact</dt><dd><Link className="text-link" to={`/contacts/${lead.contactId}`}>View contact and sales history</Link></dd></div></dl>
    </section>
    <div className="section-header"><h2>Sales opportunities</h2></div><OpportunitiesTable opportunities={lead.opportunities} />
  </>;
}

export function LeadEditor() {
  const { id } = useParams();
  const [parameters] = useSearchParams();
  const contacts = useQuery({ queryKey: ['contacts', 'all'], queryFn: ({ signal }) => crm.listContacts({}, signal) });
  const lead = useQuery({ queryKey: ['leads', id], queryFn: ({ signal }) => crm.getLead(id!, signal), enabled: Boolean(id) });
  if (!contacts.data) return contacts.isError ? <Failure error={contacts.error} retry={() => { void contacts.refetch(); }} /> : <Loading />;
  if (id && !lead.data) return lead.isError ? <Failure error={lead.error} retry={() => { void lead.refetch(); }} /> : <Loading />;
  const available = contacts.data.filter((contact) => !contact.lead || contact.lead.id === id);
  const selectedContactId = lead.data?.contactId ?? parameters.get('contactId') ?? '';
  if (contacts.isFetching && selectedContactId && !available.some((contact) => contact.id === selectedContactId)) return <Loading />;
  if (available.length === 0) return <><PageHeader title="Qualify a lead" /><Empty title="Add a contact to qualify a new lead"><p>Every current contact already has a lead.</p><Link className="button" to="/contacts/new">Add contact</Link></Empty></>;
  return <LeadFields key={id ?? `new-${selectedContactId}`} lead={lead.data} contacts={available} selectedContactId={selectedContactId} />;
}

function LeadFields({ lead: initialLead, contacts, selectedContactId }: { lead?: LeadDetail; contacts: ContactSummary[]; selectedContactId: string }) {
  const [lead] = useState(initialLead);
  const form = useSave(createLeadSchema, (values) => {
    if (!lead) return crm.createLead(values);
    const changes = changedFields<LeadInput>(lead, values);
    return Object.keys(changes).length ? crm.updateLead(lead.id, changes) : Promise.resolve(lead);
  }, (saved) => `/leads/${saved.id}`, lead ? 'Lead updated.' : 'Lead qualified.');
  const cancelTo = lead ? `/leads/${lead.id}` : '/leads';
  return <>
    <PageHeader title={lead ? 'Edit lead' : 'Qualify a lead'} back={{ to: cancelTo, label: lead ? 'Lead details' : 'Leads' }} />
    <RecordForm error={form.error} pending={form.pending} cancelTo={cancelTo} submitLabel={lead ? 'Save lead' : 'Create lead'} onSubmit={(data) => form.submit({
      contactId: data.get('contactId'), leadScore: Number(data.get('leadScore')), stage: data.get('stage'),
    })}>
      <div className="full-width"><Field label="Contact" name="contactId" error={form.fieldErrors.contactId}>{(attributes) => <select {...attributes} defaultValue={lead?.contactId ?? selectedContactId} required>
        <option value="">Choose a contact</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.firstName} {contact.lastName} — {contact.company}</option>)}
      </select>}</Field></div>
      <Field label="Lead score (1–10)" name="leadScore" error={form.fieldErrors.leadScore}>{(attributes) => <input {...attributes} type="number" min={1} max={10} step={1} defaultValue={lead?.leadScore ?? ''} required />}</Field>
      <Field label="Stage" name="stage" error={form.fieldErrors.stage}>{(attributes) => <select {...attributes} defaultValue={lead?.stage ?? 'Prospecting'}>{stageSchema.options.map((stage) => <option key={stage}>{stage}</option>)}</select>}</Field>
    </RecordForm>
  </>;
}
