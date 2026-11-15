import { Link } from 'react-router-dom';
import { crm } from '@crm-data';
import { Brand } from '../components/brand';
import { Icon } from '../components/icons';

export function LandingPage() {
  const destination = crm.kind === 'demo' ? '/overview' : '/signin';
  return <div className="landing">
    <header className="landing-nav"><Brand to="/welcome" /><div className="actions">
      <button className="text-link plain-button" onClick={() => { document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }); document.getElementById('features')?.focus({ preventScroll: true }); }}>How it works</button>
      <Link className="button compact" to={destination}>{crm.kind === 'demo' ? 'Open demo' : 'Sign in'}<Icon name="arrow" size={15} /></Link>
    </div></header>
    <main>
      <section className="landing-hero">
        <div className="hero-copy"><p className="eyebrow"><span className="live-dot" /> SMALL TEAM. CLEARER PICTURE.</p>
          <h1>Less admin.<br />More <em>connection.</em></h1>
          <p className="hero-description">A little more clarity for the way you sell. Bring your contacts, leads, and opportunities together in one thoughtfully simple workspace.</p>
          <Link className="button hero-cta" to={destination}>{crm.kind === 'demo' ? 'Explore the demo' : 'Open your workspace'}<Icon name="arrow" /></Link>
          <p className="hero-footnote"><Icon name="check" size={15} />{crm.kind === 'demo' ? 'Fictional data. No account needed. Resets on reload.' : 'One shared workspace. Built for your team.'}</p>
        </div>
        <div className="hero-visual" aria-label="Illustration of a fictional sales pipeline">
          <div className="visual-caption"><span className="live-dot" /> A PLACE FOR EVERY POSSIBILITY <span>01 — 06</span></div>
          <div className="visual-heading">Good things<br />start with a <em>hello.</em></div>
          <div className="preview-card"><div className="preview-avatar">ME</div><div><strong>Mariam Example</strong><small>Fictional Studio · Website</small></div><span className="preview-score">8<small>/10</small></span></div>
          <div className="preview-connector"><span /> A conversation becomes an opportunity <span /></div>
          <div className="preview-opportunity"><div><span className="eyebrow">ILLUSTRATIVE OPPORTUNITY</span><strong>A fresh beginning</strong></div><span className="stage stage-proposal">Proposal</span><p>EGP 25,000.00 <span>Expected value</span></p></div>
          <div className="visual-bottom"><span>Contact → Lead → Opportunity</span><span className="round-arrow"><Icon name="arrow" /></span></div>
        </div>
      </section>
      <section className="landing-features" id="features" tabIndex={-1} aria-labelledby="features-heading">
        <div className="features-intro"><p className="eyebrow">A SIMPLE WAY FORWARD</p><h2 id="features-heading">Everything you need.<br /><span>Space for what matters.</span></h2><p>Follow the whole relationship, from the first introduction to a closed lead.</p></div>
        <div className="feature-step"><span>01 /</span><Icon name="contacts" size={26} /><h3>Remember the people.</h3><p>Keep names, companies, contact details, and useful notes together. Find anyone with a quick search.</p><Link to="/contacts">Explore contacts <Icon name="arrow" size={15} /></Link></div>
        <div className="feature-step"><span>02 /</span><Icon name="leads" size={26} /><h3>See the next step.</h3><p>Give every lead a manual score and a clear stage. Keep the whole team looking at the same picture.</p><Link to="/leads">Explore leads <Icon name="arrow" size={15} /></Link></div>
        <div className="feature-step"><span>03 /</span><Icon name="opportunities" size={26} /><h3>Make room for growth.</h3><p>Track expected EGP values and close dates, with every opportunity linked back to its contact.</p><Link to="/opportunities">Explore opportunities <Icon name="arrow" size={15} /></Link></div>
      </section>
      <section className="landing-closing"><div><p className="eyebrow">LESS TO MANAGE. MORE TO BUILD.</p><h2>Your next chapter<br />starts with a conversation.</h2></div><Link className="button" to={destination}>{crm.kind === 'demo' ? 'Try the workspace' : 'Sign in to get started'}<Icon name="arrow" /></Link></section>
    </main>
    <footer className="landing-footer"><Brand to="/welcome" /><p>Thoughtfully simple. Purposefully focused.</p><span>Contacts. Conversations. Possibilities.</span></footer>
  </div>;
}
