import { useQuery } from '@tanstack/react-query';
import { useState, useTransition } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { crm } from '@crm-data';
import { createContactSchema } from '../../../backend/src/modules/contacts/schema';
import { stageSchema } from '../../../backend/src/modules/leads/stages';
import { Empty, Failure, Field, Loading, PageHeader, RecordForm, StageBadge } from '../components/common';
import type { ContactDetail, ContactInput, ContactQuery } from '../data/types';
import { changedFields, useSave } from '../hooks';
import { OpportunitiesTable } from './opportunities';

export function ContactsPage() {
  const [parameters, setParameters] = useSearchParams();
  const [applyingFilters, startFilterTransition] = useTransition();
  const filters = Object.fromEntries(parameters) as ContactQuery;
  const all = useQuery({ queryKey: ['contacts', 'all'], queryFn: ({ signal }) => crm.listContacts({}, signal) });
  const list = useQuery({
    queryKey: parameters.size ? ['contacts', 'list', parameters.toString()] : ['contacts', 'all'],
    queryFn: ({ signal }) => crm.listContacts(filters, signal),
  });
  const sources = [...new Set([...(all.data ?? []).map((contact) => contact.leadSource), filters.source ?? ''])].filter(Boolean).sort();
  return <>
    <PageHeader title="Contacts"><Link className="button" to="/contacts/new">Add contact</Link></PageHeader>
    <form className="filters panel" aria-label="Contact filters" aria-busy={applyingFilters} key={parameters.toString()} onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const next = new URLSearchParams();
      for (const name of ['search', 'source', 'stage']) {
        const value = String(values.get(name) ?? '').trim();
        if (value) next.set(name, value);
      }
      startFilterTransition(() => setParameters(next));
    }}>
      <Field label="Search contacts" name="search">{(attributes) => <input {...attributes} disabled={applyingFilters} type="search" placeholder="Name, company, or email" maxLength={200} defaultValue={filters.search ?? ''} />}</Field>
      <Field label="Lead source" name="source">{(attributes) => <select {...attributes} disabled={applyingFilters} defaultValue={filters.source ?? ''}>
        <option value="">All sources</option>{sources.map((source) => <option key={source}>{source}</option>)}
      </select>}</Field>
      <Field label="Lead stage" name="stage">{(attributes) => <select {...attributes} disabled={applyingFilters} defaultValue={filters.stage ?? ''}>
        <option value="">All stages</option>{stageSchema.options.map((stage) => <option key={stage}>{stage}</option>)}
      </select>}</Field>
      <button className="button secondary" type="submit" disabled={applyingFilters}>{applyingFilters ? 'Applying…' : 'Apply filters'}</button>
      {parameters.size > 0 && <Link className="text-link" to="/contacts">Clear filters</Link>}
    </form>
    {list.isError && <Failure error={list.error} retry={() => { void list.refetch(); void all.refetch(); }} />}
    {!list.data ? !list.isError && <Loading /> : <>
      <p className="result-count" role="status">{list.data.length} {list.data.length === 1 ? 'contact' : 'contacts'}</p>
      {list.data.length === 0 ? <Empty title={parameters.size ? 'No contacts match these filters' : 'Your contacts start here'}>
        <p>{parameters.size ? 'Try another search or clear the filters.' : 'Add your first contact to begin qualifying leads.'}</p>
        <Link className="button secondary" to={parameters.size ? '/contacts' : '/contacts/new'}>{parameters.size ? 'Clear filters' : 'Add contact'}</Link>
      </Empty> : <div className="table-wrap panel"><table><caption className="sr-only">Contacts</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Company</th><th scope="col">Email</th><th scope="col">Source</th><th scope="col">Lead stage</th></tr></thead>
        <tbody>{list.data.map((contact) => <tr key={contact.id}>
          <td><Link className="record-link" to={`/contacts/${contact.id}`}>{contact.firstName} {contact.lastName}</Link></td>
          <td>{contact.company}</td><td>{contact.email}</td><td>{contact.leadSource}</td><td><StageBadge stage={contact.lead?.stage} /></td>
        </tr>)}</tbody>
      </table></div>}
    </>}
  </>;
}

export function ContactPage() {
  const { id = '' } = useParams();
  const query = useQuery({ queryKey: ['contacts', id], queryFn: ({ signal }) => crm.getContact(id, signal) });
  if (!query.data) return query.isError ? <Failure error={query.error} retry={() => { void query.refetch(); }} /> : <Loading />;
  const contact = query.data;
  return <>
    <PageHeader title={`${contact.firstName} ${contact.lastName}`} back={{ to: '/contacts', label: 'Contacts' }}>
      <Link className="button secondary" to={`/contacts/${id}/edit`}>Edit contact</Link>
    </PageHeader>
    {query.isError && <Failure error={query.error} retry={() => { void query.refetch(); }} />}
    <div className="detail-grid">
      <section className="panel detail-panel" aria-labelledby="contact-heading"><h2 id="contact-heading">Contact information</h2>
        <dl><div><dt>Company</dt><dd>{contact.company}</dd></div><div><dt>Email</dt><dd><a href={`mailto:${contact.email}`}>{contact.email}</a></dd></div>
          <div><dt>Phone</dt><dd>{contact.phone || 'Not provided'}</dd></div><div><dt>Lead source</dt><dd>{contact.leadSource}</dd></div></dl>
        <h3>Notes</h3><p className="notes">{contact.notes || 'No notes yet.'}</p>
      </section>
      <section className="panel detail-panel" aria-labelledby="qualification-heading"><h2 id="qualification-heading">Lead qualification</h2>
        {contact.lead ? <>
          <StageBadge stage={contact.lead.stage} /><dl><div><dt>Manual score</dt><dd>{contact.lead.leadScore} / 10</dd></div></dl>
          <div className="actions"><Link className="button secondary" to={`/leads/${contact.lead.id}/edit`}>Edit lead</Link><Link className="text-link" to={`/leads/${contact.lead.id}`}>View lead</Link></div>
        </> : <><p className="muted">This contact has not been qualified yet.</p><Link className="button secondary" to={`/leads/new?contactId=${id}`}>Qualify lead</Link></>}
      </section>
    </div>
    <section aria-labelledby="sales-heading"><div className="section-header"><h2 id="sales-heading">Sales opportunities</h2>
      {contact.lead && <Link className="button" to={`/opportunities/new?leadId=${contact.lead.id}`}>Add opportunity</Link>}
    </div>
      {contact.lead ? <OpportunitiesTable opportunities={contact.lead.opportunities} /> : <Empty title="Qualify this contact to add opportunities" />}
    </section>
  </>;
}

export function ContactEditor() {
  const { id } = useParams();
  const query = useQuery({ queryKey: ['contacts', id], queryFn: ({ signal }) => crm.getContact(id!, signal), enabled: Boolean(id) });
  if (id && !query.data) return query.isError ? <Failure error={query.error} retry={() => { void query.refetch(); }} /> : <Loading />;
  return <ContactFields key={id ?? 'new'} contact={query.data} />;
}

function ContactFields({ contact: initialContact }: { contact?: ContactDetail }) {
  const [contact] = useState(initialContact);
  const form = useSave(createContactSchema, (values) => {
    if (!contact) return crm.createContact(values);
    const changes = changedFields<ContactInput>(contact, values);
    return Object.keys(changes).length ? crm.updateContact(contact.id, changes) : Promise.resolve(contact);
  }, (saved) => `/contacts/${saved.id}`, contact ? 'Contact updated.' : 'Contact created.');
  const cancelTo = contact ? `/contacts/${contact.id}` : '/contacts';
  return <>
    <PageHeader title={contact ? 'Edit contact' : 'New contact'} back={{ to: cancelTo, label: contact ? 'Contact details' : 'Contacts' }} />
    <RecordForm error={form.error} pending={form.pending} cancelTo={cancelTo} submitLabel={contact ? 'Save contact' : 'Create contact'} onSubmit={(data) => form.submit({
      firstName: data.get('firstName'), lastName: data.get('lastName'), email: data.get('email'),
      phone: data.get('phone'), company: data.get('company'), leadSource: data.get('leadSource'), notes: data.get('notes') || null,
    })}>
      <Field label="First name" name="firstName" error={form.fieldErrors.firstName}>{(attributes) => <input {...attributes} defaultValue={contact?.firstName ?? ''} autoComplete="given-name" maxLength={200} required />}</Field>
      <Field label="Last name" name="lastName" error={form.fieldErrors.lastName}>{(attributes) => <input {...attributes} defaultValue={contact?.lastName ?? ''} autoComplete="family-name" maxLength={200} required />}</Field>
      <Field label="Email" name="email" error={form.fieldErrors.email}>{(attributes) => <input {...attributes} type="email" defaultValue={contact?.email ?? ''} autoComplete="email" maxLength={254} required />}</Field>
      <Field label="Phone (optional)" name="phone" error={form.fieldErrors.phone}>{(attributes) => <input {...attributes} type="tel" defaultValue={contact?.phone ?? ''} autoComplete="tel" maxLength={50} />}</Field>
      <Field label="Company" name="company" error={form.fieldErrors.company}>{(attributes) => <input {...attributes} defaultValue={contact?.company ?? ''} autoComplete="organization" maxLength={200} required />}</Field>
      <Field label="Lead source" name="leadSource" error={form.fieldErrors.leadSource}>{(attributes) => <input {...attributes} list="source-suggestions" defaultValue={contact?.leadSource ?? ''} maxLength={200} required />}</Field>
      <datalist id="source-suggestions">{['Website Form', 'Referral', 'Event', 'Outbound', 'Other'].map((source) => <option key={source} value={source} />)}</datalist>
      <div className="full-width"><Field label="Notes (optional)" name="notes" error={form.fieldErrors.notes}>{(attributes) => <textarea {...attributes} rows={5} defaultValue={contact?.notes ?? ''} />}</Field></div>
    </RecordForm>
  </>;
}
