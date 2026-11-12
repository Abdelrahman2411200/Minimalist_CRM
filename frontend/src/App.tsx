import { useEffect, useState } from 'react';

const sections = [
  { id: 'contacts', title: 'Contacts', description: 'Keep the people and companies you work with in one place.' },
  { id: 'leads', title: 'Leads', description: 'Qualify interest and follow each lead through the sales process.' },
  { id: 'opportunities', title: 'Opportunities', description: 'Track potential deals, estimated values, and expected close dates.' },
] as const;

function readSection() {
  return sections.find((section) => `#/${section.id}` === window.location.hash) ?? sections[0];
}

export default function App() {
  const [section, setSection] = useState(readSection);
  const title = import.meta.env.VITE_APP_TITLE?.trim() || 'Minimalist CRM';

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    const handleNavigation = () => setSection(readSection());
    window.addEventListener('hashchange', handleNavigation);
    return () => window.removeEventListener('hashchange', handleNavigation);
  }, []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={(event) => {
        event.preventDefault();
        document.getElementById('main-content')?.focus();
      }}>Skip to content</a>
      <header className="app-header">
        <a className="brand" href="#/contacts"><span className="brand-mark" aria-hidden="true">m.</span>{title}</a>
        <span className="environment-label">Development preview</span>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <p className="eyebrow">Workspace</p>
          <nav aria-label="Main navigation">
            {sections.map((item) => (
              <a key={item.id} href={`#/${item.id}`} aria-current={section.id === item.id ? 'page' : undefined}>
                {item.title}
              </a>
            ))}
          </nav>
          <p className="sidebar-note">A simpler place to keep sales moving.</p>
        </aside>
        <main id="main-content" tabIndex={-1}>
          <p className="eyebrow">Your CRM</p>
          <h1>{section.title}</h1>
          <p className="page-description">{section.description}</p>
          <section className="empty-state" aria-labelledby="preview-heading">
            <span className="empty-mark" aria-hidden="true">↗</span>
            <h2 id="preview-heading">Your workspace starts here</h2>
            <p>The application foundation is ready. {section.title} will be available as the CRM features are added.</p>
            <span className="phase-label">Phase 1 · Application shell</span>
          </section>
        </main>
      </div>
      <footer>Minimalist CRM <span>Contacts → Leads → Opportunities</span></footer>
    </div>
  );
}
