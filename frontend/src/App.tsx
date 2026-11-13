import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HashRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { crm } from '@crm-data';
import { loginSchema } from '../../backend/src/modules/auth/schema';
import { Empty, Failure, Field, Loading } from './components/common';
import { validationError, CrmError } from './data/errors';
import { ContactEditor, ContactPage, ContactsPage } from './pages/contacts';
import { LeadEditor, LeadPage, LeadsPage } from './pages/leads';
import { OpportunityEditor, OpportunityPage, OpportunitiesPage } from './pages/opportunities';
import { updateSession, type SessionState } from './state';

const title = import.meta.env.VITE_APP_TITLE?.trim() || 'Minimalist CRM';

function Brand() {
  return <Link className="brand" to="/contacts"><span className="brand-mark" aria-hidden="true">m.</span>{title}</Link>;
}

function SignIn({ expired }: { expired: boolean }) {
  const client = useQueryClient();
  const [localError, setLocalError] = useState<CrmError | null>(null);
  const mutation = useMutation({
    mutationFn: (credentials: { username: string; password: string }) => crm.login(credentials.username, credentials.password),
    onSuccess: (user) => {
      updateSession(client, { user, expired: false });
    },
  });
  const error = localError ?? mutation.error;
  const fieldErrors = error instanceof CrmError ? Object.fromEntries(error.details.map((issue) => [issue.path, issue.message])) : {};
  return <div className="sign-in-layout">
    <Brand />
    <main className="sign-in-card panel"><h1>Sign in</h1><p className="muted">Access your shared sales workspace.</p>
      {expired && <p className="notice" role="status">Your session expired. Sign in again to continue.</p>}
      {error && <Failure error={error} />}
      <form noValidate onSubmit={(event) => {
        event.preventDefault();
        mutation.reset();
        const data = new FormData(event.currentTarget);
        const result = loginSchema.safeParse({ username: data.get('username'), password: data.get('password') });
        if (!result.success) { setLocalError(validationError(result.error)); return; }
        setLocalError(null);
        mutation.mutate(result.data);
      }}>
        <fieldset disabled={mutation.isPending}>
          <Field label="Username" name="username" error={fieldErrors.username}>{(attributes) => <input {...attributes} autoComplete="username" autoCapitalize="none" maxLength={64} required />}</Field>
          <Field label="Password" name="password" error={fieldErrors.password}>{(attributes) => <input {...attributes} type="password" autoComplete="current-password" maxLength={128} required />}</Field>
          <button className="button" type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Signing in…' : 'Sign in'}</button>
        </fieldset>
      </form>
    </main>
  </div>;
}

function Dashboard({ username }: { username: string }) {
  const location = useLocation();
  const client = useQueryClient();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const logout = useMutation({
    mutationFn: () => crm.logout(),
    meta: { requiresAuth: true },
    onSuccess: () => {
      updateSession(client, { user: null, expired: false });
    },
  });
  useEffect(() => {
    document.getElementById('main-content')?.focus();
  }, [location.pathname]);

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    <header className="app-header"><Brand /><div className="account-controls"><span>{username}</span>
      {crm.kind === 'full' && <button className="button secondary compact" type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>{logout.isPending ? 'Signing out…' : 'Sign out'}</button>}
    </div></header>
    {crm.kind === 'demo' && <div className="demo-banner"><p><strong>Demo</strong> · Fictional data. Changes reset on reload.</p>
      {import.meta.env.VITE_FULL_CRM_URL && <a href={import.meta.env.VITE_FULL_CRM_URL} target="_blank" rel="noopener noreferrer">Open full CRM ↗</a>}
    </div>}
    <div className="workspace"><aside className="sidebar"><nav aria-label="Main navigation">
      <NavLink to="/contacts">Contacts</NavLink><NavLink to="/leads">Leads</NavLink><NavLink to="/opportunities">Opportunities</NavLink>
    </nav></aside>
      <main id="main-content" tabIndex={-1}>
        {notice && <p className="notice" role="status">{notice}</p>}
        {logout.isError && <Failure error={logout.error} retry={() => logout.mutate()} />}
        <Routes>
          <Route path="/" element={<Navigate to="/contacts" replace />} />
          <Route path="/signin" element={<Navigate to="/contacts" replace />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/contacts/new" element={<ContactEditor />} />
          <Route path="/contacts/:id" element={<ContactPage />} />
          <Route path="/contacts/:id/edit" element={<ContactEditor />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/leads/new" element={<LeadEditor />} />
          <Route path="/leads/:id" element={<LeadPage />} />
          <Route path="/leads/:id/edit" element={<LeadEditor />} />
          <Route path="/opportunities" element={<OpportunitiesPage />} />
          <Route path="/opportunities/new" element={<OpportunityEditor />} />
          <Route path="/opportunities/:id" element={<OpportunityPage />} />
          <Route path="/opportunities/:id/edit" element={<OpportunityEditor />} />
          <Route path="*" element={<Empty title="Page not found"><Link className="button secondary" to="/contacts">Back to contacts</Link></Empty>} />
        </Routes>
      </main>
    </div>
  </div>;
}

function SessionGate() {
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async ({ signal }): Promise<SessionState> => {
      const user = await crm.me(signal);
      const previous = client.getQueryData<SessionState>(['session']);
      return { user, expired: !user && Boolean(previous?.user || previous?.expired) };
    },
    refetchOnWindowFocus: true,
  });
  useEffect(() => { document.title = title; }, []);
  if (session.isPending) return <div className="session-state"><Loading label={crm.kind === 'demo' ? 'Opening demo…' : 'Checking sign-in…'} /></div>;
  if (session.isError) return <div className="sign-in-layout"><Brand /><Failure error={session.error} retry={() => { void session.refetch(); }} /></div>;
  if (!session.data.user) return <SignIn expired={session.data.expired} />;
  return <Dashboard username={session.data.user.username} />;
}

export default function App() {
  return <HashRouter><SessionGate /></HashRouter>;
}
