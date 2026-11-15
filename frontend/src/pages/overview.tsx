import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { crm } from '@crm-data';
import { stageSchema } from '../../../backend/src/modules/leads/stages';
import { Empty, Failure, Loading, PageHeader, StageBadge } from '../components/common';
import { Icon } from '../components/icons';
import { formatDate, formatMoney, sumMoney } from '../format';

export function OverviewPage() {
  const contacts = useQuery({ queryKey: ['contacts', 'all'], queryFn: ({ signal }) => crm.listContacts({}, signal) });
  const leads = useQuery({ queryKey: ['leads', 'all'], queryFn: ({ signal }) => crm.listLeads({}, signal) });
  const opportunities = useQuery({ queryKey: ['opportunities', 'all'], queryFn: ({ signal }) => crm.listOpportunities({}, signal) });
  const queries = [contacts, leads, opportunities];
  const refreshing = queries.some((query) => query.isFetching);
  const refresh = () => { void Promise.all(queries.map((query) => query.refetch())); };
  const error = queries.find((query) => query.error)?.error;
  if (!contacts.data || !leads.data || !opportunities.data) return error ? <Failure error={error} retry={refresh} /> : <Loading label="Bringing your workspace together…" />;
  const closed = new Set(leads.data.filter((lead) => lead.stage.startsWith('Closed')).map((lead) => lead.id));
  const open = opportunities.data.filter((opportunity) => !closed.has(opportunity.leadId));
  const stages = stageSchema.options.map((stage) => ({ stage, count: leads.data.filter((lead) => lead.stage === stage).length }));
  const max = Math.max(1, ...stages.map((stage) => stage.count));
  const next = [...open].sort((a, b) => a.closeDate.localeCompare(b.closeDate)).slice(0, 4);
  return <>
    <PageHeader title="A little clarity, a lot of possibility."><button className="button secondary" onClick={refresh} disabled={refreshing}><Icon name="refresh" />{refreshing ? 'Refreshing…' : 'Refresh overview'}</button><Link className="button" to="/contacts/new"><Icon name="plus" />Add contact</Link></PageHeader>
    <p className="page-intro">Your relationships at a glance. A clear view of where things stand and what comes next.</p>
    {error && <Failure error={error} retry={refresh} />}
    <div className="stats-grid">
      <Link className="stat-card" to="/contacts"><span><Icon name="contacts" />Total contacts<Icon name="arrow" size={15} /></span><strong>{contacts.data.length}</strong><small>People in your workspace</small></Link>
      <Link className="stat-card" to="/leads"><span><Icon name="leads" />Open leads<Icon name="arrow" size={15} /></span><strong>{leads.data.length - closed.size}</strong><small>Conversations still moving</small></Link>
      <Link className="stat-card" to="/opportunities"><span><Icon name="opportunities" />Opportunities<Icon name="arrow" size={15} /></span><strong>{opportunities.data.length}</strong><small>Across all linked leads</small></Link>
      <Link className="stat-card accent-stat" to="/opportunities"><span>Open pipeline<Icon name="arrow" size={15} /></span><strong className="stat-money">{formatMoney(sumMoney(open.map((opportunity) => opportunity.estimatedValue)))}</strong><small>Expected value · excludes closed leads</small></Link>
    </div>
    <div className="overview-grid">
      <section className="panel overview-panel" aria-labelledby="pipeline-heading"><div className="section-header"><div><p className="eyebrow">EVERY CONVERSATION HAS A NEXT STEP</p><h2 id="pipeline-heading">Your lead pipeline</h2></div><Link className="text-link" to="/leads">View leads <Icon name="arrow" size={15} /></Link></div>
        <div className="pipeline-bars">{stages.map(({ stage, count }) => <Link className="pipeline-row" key={stage} to={`/contacts?stage=${encodeURIComponent(stage)}`} aria-label={`${stage}: ${count} leads. View contacts`}><span>{stage}</span><progress max={max} value={count} aria-label={`${stage} lead count`} /><strong>{count}</strong></Link>)}</div>
        <p className="subtle-caption">Stage belongs to the lead as a whole. Scores stay in your hands.</p>
      </section>
      <section className="panel overview-panel" aria-labelledby="next-heading"><div className="section-header"><div><p className="eyebrow">ON THE HORIZON</p><h2 id="next-heading">Expected next</h2></div><Link className="text-link" to="/opportunities">View all <Icon name="arrow" size={15} /></Link></div>
        {next.length ? <div className="upcoming-list">{next.map((opportunity) => <Link key={opportunity.id} to={`/opportunities/${opportunity.id}`}><span className="opportunity-icon"><Icon name="opportunities" /></span><span><strong>{opportunity.opportunityName}</strong><small>{formatDate(opportunity.closeDate)}</small></span><b>{formatMoney(opportunity.estimatedValue)}</b></Link>)}</div> : <Empty title="Room for your next opportunity"><p>Add an opportunity to an open lead to see it here.</p><Link className="text-link" to="/opportunities/new">Add opportunity <Icon name="arrow" size={15} /></Link></Empty>}
      </section>
    </div>
    <section className="panel overview-panel" aria-labelledby="recent-heading"><div className="section-header"><div><p className="eyebrow">KEEP THE CONNECTION GOING</p><h2 id="recent-heading">Recent contacts</h2></div><Link className="text-link" to="/contacts">All contacts <Icon name="arrow" size={15} /></Link></div>
      {contacts.data.length ? <div className="recent-grid">{contacts.data.slice(0, 4).map((contact) => <Link className="recent-contact" key={contact.id} to={`/contacts/${contact.id}`}><span className="contact-avatar">{contact.firstName.slice(0, 1)}{contact.lastName.slice(0, 1)}</span><strong>{contact.firstName} {contact.lastName}<small>{contact.company}</small></strong><StageBadge stage={contact.lead?.stage} /></Link>)}</div> : <Empty title="Start with a hello"><Link className="button secondary" to="/contacts/new">Add your first contact</Link></Empty>}
    </section>
  </>;
}
