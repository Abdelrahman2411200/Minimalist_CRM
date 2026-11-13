import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { crm } from '@crm-data';
import { createOpportunitySchema } from '../../../backend/src/modules/opportunities/schema';
import { Empty, Failure, Field, Loading, PageHeader, RecordForm, StageBadge } from '../components/common';
import type { LeadDetail, Opportunity, OpportunityInput } from '../data/types';
import { changedFields, useSave } from '../hooks';
import { formatDate, formatMoney } from '../format';

export function OpportunitiesTable({ opportunities }: { opportunities: Opportunity[] }) {
  if (opportunities.length === 0) return <Empty title="No opportunities yet"><p>Add an opportunity to track its value and expected close date.</p></Empty>;
  return <div className="panel table-wrap"><table><caption className="sr-only">Sales opportunities</caption>
    <thead><tr><th scope="col">Opportunity</th><th scope="col">Estimated value</th><th scope="col">Expected close</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{opportunities.map((opportunity) => <tr key={opportunity.id}><td><Link className="record-link" to={`/opportunities/${opportunity.id}`}>{opportunity.opportunityName}</Link></td>
      <td className="money">{formatMoney(opportunity.estimatedValue)}</td><td>{formatDate(opportunity.closeDate)}</td><td><Link className="text-link" to={`/opportunities/${opportunity.id}/edit`} aria-label={`Edit ${opportunity.opportunityName}`}>Edit</Link></td>
    </tr>)}</tbody>
  </table></div>;
}

export function OpportunitiesPage() {
  const query = useQuery({ queryKey: ['opportunities', 'all'], queryFn: ({ signal }) => crm.listOpportunities({}, signal) });
  return <>
    <PageHeader title="Opportunities"><Link className="button" to="/opportunities/new">Add opportunity</Link></PageHeader>
    {query.isError && <Failure error={query.error} retry={() => { void query.refetch(); }} />}
    {!query.data ? !query.isError && <Loading /> : <><p className="result-count">{query.data.length} opportunities</p><OpportunitiesTable opportunities={query.data} /></>}
  </>;
}

export function OpportunityPage() {
  const { id = '' } = useParams();
  const opportunity = useQuery({ queryKey: ['opportunities', id], queryFn: ({ signal }) => crm.getOpportunity(id, signal) });
  const leadId = opportunity.data?.leadId;
  const lead = useQuery({ queryKey: ['leads', leadId], queryFn: ({ signal }) => crm.getLead(leadId!, signal), enabled: Boolean(leadId) });
  if (!opportunity.data) return opportunity.isError ? <Failure error={opportunity.error} retry={() => { void opportunity.refetch(); }} /> : <Loading />;
  const record = opportunity.data;
  return <>
    <PageHeader title={record.opportunityName} back={{ to: '/opportunities', label: 'Opportunities' }}><Link className="button secondary" to={`/opportunities/${id}/edit`}>Edit opportunity</Link></PageHeader>
    <section className="panel detail-panel" aria-label="Opportunity details"><dl className="horizontal-details">
      <div><dt>Estimated value</dt><dd className="value">{formatMoney(record.estimatedValue)}</dd></div><div><dt>Expected close date</dt><dd>{formatDate(record.closeDate)}</dd></div>
      <div><dt>Lead</dt><dd>{lead.data ? <><Link className="text-link" to={`/leads/${leadId}`}>{lead.data.contact.firstName} {lead.data.contact.lastName}</Link><StageBadge stage={lead.data.stage} /></> : lead.isError ? <Failure error={lead.error} retry={() => { void lead.refetch(); }} /> : <Loading label="Loading lead…" />}</dd></div>
    </dl></section>
    {lead.data && <Link className="text-link" to={`/contacts/${lead.data.contactId}`}>View contact and sales history <span aria-hidden="true">→</span></Link>}
  </>;
}

export function OpportunityEditor() {
  const { id } = useParams();
  const [parameters] = useSearchParams();
  const leads = useQuery({ queryKey: ['leads', 'all'], queryFn: ({ signal }) => crm.listLeads({}, signal) });
  const opportunity = useQuery({ queryKey: ['opportunities', id], queryFn: ({ signal }) => crm.getOpportunity(id!, signal), enabled: Boolean(id) });
  if (!leads.data) return leads.isError ? <Failure error={leads.error} retry={() => { void leads.refetch(); }} /> : <Loading />;
  if (id && !opportunity.data) return opportunity.isError ? <Failure error={opportunity.error} retry={() => { void opportunity.refetch(); }} /> : <Loading />;
  const selectedLeadId = opportunity.data?.leadId ?? parameters.get('leadId') ?? '';
  if (leads.isFetching && selectedLeadId && !leads.data.some((lead) => lead.id === selectedLeadId)) return <Loading />;
  if (leads.data.length === 0) return <><PageHeader title="New opportunity" /><Empty title="Qualify a lead first"><p>Every opportunity belongs to a lead.</p><Link className="button" to="/leads/new">Qualify lead</Link></Empty></>;
  return <OpportunityFields key={id ?? `new-${selectedLeadId}`} opportunity={opportunity.data} leads={leads.data} selectedLeadId={selectedLeadId} />;
}

function OpportunityFields({ opportunity: initialOpportunity, leads, selectedLeadId }: { opportunity?: Opportunity; leads: LeadDetail[]; selectedLeadId: string }) {
  const [opportunity] = useState(initialOpportunity);
  const form = useSave(createOpportunitySchema, (values) => {
    if (!opportunity) return crm.createOpportunity(values);
    const changes = changedFields<OpportunityInput>(opportunity, values);
    return Object.keys(changes).length ? crm.updateOpportunity(opportunity.id, changes) : Promise.resolve(opportunity);
  }, (saved) => `/opportunities/${saved.id}`, opportunity ? 'Opportunity updated.' : 'Opportunity created.');
  const cancelTo = opportunity ? `/opportunities/${opportunity.id}` : '/opportunities';
  return <>
    <PageHeader title={opportunity ? 'Edit opportunity' : 'New opportunity'} back={{ to: cancelTo, label: opportunity ? 'Opportunity details' : 'Opportunities' }} />
    <RecordForm error={form.error} pending={form.pending} cancelTo={cancelTo} submitLabel={opportunity ? 'Save opportunity' : 'Create opportunity'} onSubmit={(data) => form.submit({
      leadId: data.get('leadId'), opportunityName: data.get('opportunityName'), estimatedValue: data.get('estimatedValue'), closeDate: data.get('closeDate'),
    })}>
      <div className="full-width"><Field label="Lead" name="leadId" error={form.fieldErrors.leadId}>{(attributes) => <select {...attributes} defaultValue={opportunity?.leadId ?? selectedLeadId} required>
        <option value="">Choose a lead</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.contact.firstName} {lead.contact.lastName} — {lead.contact.company}</option>)}
      </select>}</Field></div>
      <div className="full-width"><Field label="Opportunity name" name="opportunityName" error={form.fieldErrors.opportunityName}>{(attributes) => <input {...attributes} defaultValue={opportunity?.opportunityName ?? ''} maxLength={200} required />}</Field></div>
      <Field label="Estimated value (EGP)" name="estimatedValue" error={form.fieldErrors.estimatedValue}>{(attributes) => <input {...attributes} type="text" inputMode="decimal" placeholder="0.00" defaultValue={opportunity?.estimatedValue ?? ''} required />}</Field>
      <Field label="Expected close date" name="closeDate" error={form.fieldErrors.closeDate}>{(attributes) => <input {...attributes} type="date" min="0001-01-01" max="9999-12-31" defaultValue={opportunity?.closeDate ?? ''} required />}</Field>
    </RecordForm>
  </>;
}
