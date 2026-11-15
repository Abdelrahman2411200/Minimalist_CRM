import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HashRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { crm } from '@crm-data';
import { loginSchema } from '../../backend/src/modules/auth/schema';
import { Empty, Failure, Field, Loading } from './components/common';
import { validationError, CrmError } from './data/errors';
import { ContactEditor, ContactPage, ContactsPage } from './pages/contacts';
import { LeadEditor, LeadPage, LeadsPage } from './pages/leads';
import { OpportunityEditor, OpportunityPage, OpportunitiesPage } from './pages/opportunities';
import { updateSession, type SessionState } from './state';
import { Brand } from './components/brand';
import { appTitle as title } from './title';
import { Icon } from './components/icons';
import { LandingPage } from './pages/landing';
import { OverviewPage } from './pages/overview';

function SignIn({ expired }: { expired: boolean }) {
  const client = useQueryClient();
  const [localError, setLocalError] = useState<CrmError | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const mutation = useMutation({
    mutationFn: (credentials: { username: string; password: string }) => crm.login(credentials.username, credentials.password),
    onSuccess: (user) => {
      updateSession(client, { user, expired: false });
    },
  });
  const error = localError ?? mutation.error;
  const fieldErrors = error instanceof CrmError ? Object.fromEntries(error.details.map((issue) => [issue.path, issue.message])) : {};
  return <div className="sign-in-layout">
    <aside className="sign-in-story"><Brand to="/welcome" /><div><p className="eyebrow">A LITTLE MORE CLARITY.</p><h2>Good relationships.<br /><em>Great possibilities.</em></h2><p>A calm, connected workspace for your next conversation.</p><div className="signin-flow"><span>Contacts</span><Icon name="arrow" /><span>Leads</span><Icon name="arrow" /><span>Opportunities</span></div></div><p className="story-footer">Thoughtfully simple. Purposefully focused.</p></aside>
    <main className="sign-in-card panel"><p className="eyebrow">WELCOME BACK</p><h1>Sign in</h1><p className="muted">Your next conversation starts here.</p>
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
          <Field label="Password" name="password" error={fieldErrors.password}>{(attributes) => <div className="password-field"><input {...attributes} type={showPassword ? 'text' : 'password'} autoComplete="current-password" maxLength={128} required /><button className="plain-button" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button></div>}</Field>
          <button className="button" type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Signing in…' : 'Sign in'}</button>
        </fieldset>
      </form>
      <p className="signin-security"><Icon name="shield" size={16} /> A shared workspace for authorized staff.</p>
      <Link className="text-link" to="/welcome">← Back to the introduction</Link>
    </main>
  </div>;
}

function Dashboard({ username }: { username: string }) {
  const location = useLocation();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const section = ({ overview: 'Overview', contacts: 'Contacts', leads: 'Leads', opportunities: 'Opportunities' } as Record<string, string>)[location.pathname.split('/')[1] ?? ''] || 'Workspace';
  const notice = (location.state as { notice?: string } | null)?.notice;
  const logout = useMutation({
    mutationFn: () => crm.logout(),
    meta: { requiresAuth: true },
    onSuccess: () => {
      updateSession(client, { user: null, expired: false });
    },
  });
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [location.pathname]);

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    <header className="app-header"><div className="workspace-label"><span className="eyebrow">YOUR WORKSPACE</span><strong>{section}</strong></div>
      <form className="workspace-search" role="search" onSubmit={(event) => { event.preventDefault(); navigate(`/contacts${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`); }}><Icon name="search" /><input aria-label="Search workspace" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a person or company…" maxLength={200} /><button type="submit" aria-label="Search workspace contacts"><Icon name="arrow" size={16} /></button></form>
      <div className="account-controls"><span className="user-avatar" aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span><span>{crm.kind === 'demo' ? 'Demo workspace' : username}</span>
      {crm.kind === 'full' && <button className="button secondary compact" type="button" onClick={() => logout.mutate()} disabled={logout.isPending}><Icon name="logout" size={15} />{logout.isPending ? 'Signing out…' : 'Sign out'}</button>}
    </div></header>
    {crm.kind === 'demo' && <div className="demo-banner"><p><strong>Demo</strong> · Fictional data. Changes reset on reload.</p>
      {import.meta.env.VITE_FULL_CRM_URL && <a href={import.meta.env.VITE_FULL_CRM_URL} target="_blank" rel="noopener noreferrer">Open full CRM ↗</a>}
    </div>}
    <div className="workspace"><aside className="sidebar"><Brand to="/overview" /><span className="sidebar-caption">THE BIG PICTURE</span><nav aria-label="Main navigation">
      <NavLink to="/overview"><Icon name="overview" />Overview</NavLink><NavLink to="/contacts"><Icon name="contacts" />Contacts</NavLink><NavLink to="/leads"><Icon name="leads" />Leads</NavLink><NavLink to="/opportunities"><Icon name="opportunities" />Opportunities</NavLink>
    </nav><div className="sidebar-note"><span className="live-dot" /><strong>A little less busywork.</strong><p>More room for the people behind your pipeline.</p><Link to="/welcome">Meet your workspace <Icon name="arrow" size={15} /></Link></div><span className="sidebar-bottom">SIMPLE BY DESIGN. HUMAN AT HEART.</span></aside>
      <main id="main-content" tabIndex={-1}>
        {notice && <p className="notice" role="status">{notice}</p>}
        {logout.isError && <Failure error={logout.error} retry={() => logout.mutate()} />}
        <Routes>
          <Route path="/" element={<Navigate to="/contacts" replace />} />
          <Route path="/signin" element={<Navigate to="/contacts" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
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
  return <HashRouter><AppRoute /></HashRouter>;
}

function AppRoute() {
  const { pathname } = useLocation();
  useEffect(() => { document.title = title; }, []);
  return pathname === '/welcome' || (pathname === '/' && crm.kind === 'full') ? <LandingPage /> : <SessionGate />;
}
