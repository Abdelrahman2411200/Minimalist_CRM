import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnvironment } from 'dotenv';
import express from 'express';
import { Builder, By, Key, until, type WebDriver } from 'selenium-webdriver';
import * as chrome from 'selenium-webdriver/chrome.js';
import { build } from 'vite';
import { createApp } from '../../backend/src/app';
import { loadAuthConfig } from '../../backend/src/config';
import { createDatabase } from '../../backend/src/database';
import { hashPassword } from '../../backend/src/modules/auth/password';
import { createSessionStore } from '../../backend/src/modules/auth/session';
import { createTelemetry } from '../../backend/src/telemetry/http';
import { createTestDatabase, runPrisma } from '../../backend/tests/helpers/database';

loadEnvironment({ path: fileURLToPath(new URL('../../backend/.env', import.meta.url)), quiet: true });
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'test-results/selenium');
await mkdir(resolve(output, 'screenshots'), { recursive: true });
const password = randomBytes(24).toString('base64url');
const username = 'selenium-staff';
const cases: { name: string; status: 'PASS' | 'FAIL'; detail: string }[] = [];
let driver: WebDriver | undefined;
let target = '';
let contactUrl = '';
let opportunityUrl = '';
let failures = 0;
const redact = (value: string) => value.replaceAll(password, '[redacted]').replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]').replace(/crm\.sid=[^\s;]+/g, 'crm.sid=[redacted]').slice(0, 1_600);

async function scenario(name: string, action: () => Promise<void>) {
  try { await action(); cases.push({ name, status: 'PASS', detail: 'Verified.' }); console.info(`PASS: ${name}`); }
  catch (error) {
    failures++;
    const detail = redact(error instanceof Error ? error.message : 'Unknown error');
    cases.push({ name, status: 'FAIL', detail });
    console.error(`FAIL: ${name}. See the generated Markdown report.`);
  }
}
function browser() { assert.ok(driver, 'Browser is available'); return driver; }
async function element(locator: By) { return browser().wait(until.elementLocated(locator), 10_000); }
async function click(text: string, tag = 'button') {
  const found = await element(By.xpath(`//${tag}[normalize-space(.)=${JSON.stringify(text)}]`));
  await browser().wait(until.elementIsVisible(found), 10_000);
  await browser().wait(until.elementIsEnabled(found), 10_000);
  await browser().executeScript('arguments[0].scrollIntoView({block:"center",behavior:"instant"})', found);
  await found.click();
}
async function fill(name: string, value: string) {
  const found = await element(By.css(`[name="${name}"]`));
  if (await found.getAttribute('type') === 'date') {
    await browser().executeScript('Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(arguments[0],arguments[1]);arguments[0].dispatchEvent(new Event("input",{bubbles:true}));arguments[0].dispatchEvent(new Event("change",{bubbles:true}));', found, value);
    return;
  }
  await found.clear(); await found.sendKeys(value);
}
async function select(name: string, value: string) {
  const option = await element(By.xpath(`//select[@name="${name}"]/option[@value=${JSON.stringify(value)} or normalize-space(.)=${JSON.stringify(value)}]`));
  await option.click();
}
async function heading(text: string) { await browser().wait(async () => (await browser().findElements(By.xpath(`//*[self::h1 or self::h2][normalize-space(.)=${JSON.stringify(text)}]`))).length > 0, 10_000); }
async function contains(text: string) { await browser().wait(async () => (await browser().findElement(By.css('body')).getText()).includes(text), 10_000); }
async function go(path: string) { await browser().get(`${target}#${path}`); }
async function signIn() {
  await fill('username', username); await fill('password', password); await click('Sign in');
  await browser().wait(until.elementLocated(By.css('nav[aria-label="Main navigation"]')), 10_000);
}
async function screenshot(name: string) { await writeFile(resolve(output, 'screenshots', `${name}.png`), await browser().takeScreenshot(), 'base64'); }

async function buildVariant(mode: 'full' | 'demo') {
  const previous = { base: process.env.VITE_BASE_PATH, url: process.env.VITE_FULL_CRM_URL, environment: process.env.NODE_ENV };
  process.env.VITE_BASE_PATH = mode === 'demo' ? '/portfolio/' : '/';
  process.env.VITE_FULL_CRM_URL = '';
  process.env.NODE_ENV = 'production';
  const outDir = resolve(output, mode);
  try { await build({ root, mode, logLevel: 'error', build: { outDir, emptyOutDir: true } }); }
  finally {
    for (const [key, value] of Object.entries({ VITE_BASE_PATH: previous.base, VITE_FULL_CRM_URL: previous.url, NODE_ENV: previous.environment })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  return outDir;
}

const hosts: ReturnType<ReturnType<typeof express>['listen']>[] = [];
async function listen(app: ReturnType<typeof express>) {
  const server = app.listen(0, '127.0.0.1'); hosts.push(server); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/`;
}
let isolated: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
let database: ReturnType<typeof createDatabase> | undefined;
let sessions: ReturnType<typeof createSessionStore> | undefined;
let failNextRead = false;
let delayNextRead = false;
try {
  console.info('Selenium runs Chrome against built full/demo targets and a new disposable PostgreSQL database.');
  const full = await buildVariant('full');
  const demo = await buildVariant('demo');
  isolated = await createTestDatabase(); await runPrisma(['migrate', 'deploy'], isolated.url);
  database = createDatabase(isolated.url);
  await database.user.create({ data: { username, passwordHash: await hashPassword(password) } });
  sessions = createSessionStore(isolated.url);
  const app = express();
  const fullUrl = await listen(app);
  const config = loadAuthConfig({ NODE_ENV: 'test', APP_ORIGIN: fullUrl.slice(0, -1), SESSION_SECRET: randomBytes(48).toString('hex') });
  // Test-only fault injection, inaccessible outside this ephemeral loopback host.
  app.use('/api/contacts', (request, response, next) => {
    if (request.method === 'GET' && request.query.search === 'retry-test' && failNextRead) { failNextRead = false; response.status(500).json({ error: { code: 'TEST_FAILURE', message: 'Synthetic Selenium request failure.' } }); return; }
    if (request.method === 'GET' && request.query.search === 'loading-test' && delayNextRead) { delayNextRead = false; setTimeout(next, 900); return; }
    next();
  });
  app.use(createApp({ frontendDirectory: full, api: { database, config, store: sessions.store }, telemetry: createTelemetry(() => {}), checkDatabase: async () => { await database!.$queryRaw`SELECT 1`; } }));
  const demoApp = express(); demoApp.use('/portfolio/', express.static(demo));
  const demoUrl = `${await listen(demoApp)}portfolio/`;
  process.env.SE_AVOID_STATS = 'true';
  const options = new chrome.Options();
  options.addArguments('--headless=new', '--window-size=1440,1100', '--disable-dev-shm-usage');
  driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 10_000 });
  target = fullUrl;

  await scenario('Landing page: introduction, section button, feature links and sign-in CTA', async () => {
    await go('/'); await heading('Less admin.More connection.');
    await screenshot('landing-desktop'); await click('How it works');
    assert.equal(await browser().executeScript('return document.activeElement.id'), 'features');
    await click('Explore contacts', 'a'); await heading('Sign in');
    await click('← Back to the introduction', 'a'); await heading('Less admin.More connection.');
    await click('Open your workspace', 'a'); await heading('Sign in');
  });
  await scenario('Authentication: required fields, password visibility, invalid credentials and valid sign-in', async () => {
    await go('/signin'); await click('Sign in');
    assert.equal(await browser().findElement(By.css('[name="username"]')).getAttribute('aria-invalid'), 'true');
    await fill('username', username); await fill('password', 'synthetic-invalid-password');
    await click('Show'); assert.equal(await browser().findElement(By.css('[name="password"]')).getAttribute('type'), 'text');
    await click('Hide'); await click('Sign in'); await contains('Invalid username or password');
    await signIn(); await heading('Contacts'); await heading('Your contacts start here');
    const cookie = await browser().manage().getCookie('crm.sid'); assert.ok(cookie.httpOnly && cookie.sameSite === 'Lax');
  });
  await scenario('Empty parent states and cancel buttons do not create records', async () => {
    await go('/opportunities/new'); await heading('Qualify a lead first'); await click('Qualify lead', 'a'); await heading('Add a contact to qualify a new lead');
    await click('Add contact', 'a'); await click('Cancel'); await heading('Contacts');
    assert.equal(await database!.contact.count(), 0);
  });
  await scenario('Contacts: validation, create, edit, optional field preservation and detail', async () => {
    await go('/contacts/new'); await click('Create contact');
    assert.equal(await browser().findElement(By.css('[name="firstName"]')).getAttribute('aria-invalid'), 'true');
    for (const [name, value] of Object.entries({ firstName: 'Selenium', lastName: 'Example', email: 'selenium@example.test', company: 'Synthetic Selenium Studio', leadSource: 'Website Form', phone: '01000000000', notes: '<img src=x onerror="window.__crm_xss=1">' })) await fill(name, value);
    await click('Create contact'); await heading('Selenium Example'); contactUrl = await browser().getCurrentUrl();
    assert.equal(await database!.contact.count(), 1);
    assert.equal(await browser().executeScript('return window.__crm_xss'), null);
    await click('Edit contact', 'a'); await fill('company', 'Synthetic Edited Studio'); await click('Save contact'); await contains('Synthetic Edited Studio'); await contains('01000000000');
    await click('Edit contact', 'a'); await fill('company', 'Must not save'); await click('Cancel'); await contains('Synthetic Edited Studio');
  });
  await scenario('Leads: qualification, score bounds, all six stage updates and linked contact', async () => {
    await click('Qualify lead', 'a'); await fill('leadScore', '11'); await click('Create lead');
    assert.equal(await browser().findElement(By.css('[name="leadScore"]')).getAttribute('aria-invalid'), 'true');
    await fill('leadScore', '7'); await click('Create lead'); await contains('Prospecting');
    for (const stage of ['Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost', 'Qualification']) {
      await click('Edit lead', 'a'); await select('stage', stage); await fill('leadScore', '9'); await click('Save lead'); await contains(stage);
    }
    await contains('9 / 10');
    await click('Edit lead', 'a'); await fill('leadScore', '1'); await select('stage', 'Closed Lost'); await click('Cancel');
    await contains('9 / 10'); await contains('Qualification');
    await click('View contact and sales history', 'a'); await heading('Selenium Example');
  });
  await scenario('Opportunities: money/date validation, create, edit, row Edit and cancel', async () => {
    await click('Add opportunity', 'a'); await fill('opportunityName', 'Synthetic Selenium opportunity'); await fill('estimatedValue', '-1'); await fill('closeDate', '2028-02-29'); await click('Create opportunity');
    assert.equal(await browser().findElement(By.css('[name="estimatedValue"]')).getAttribute('aria-invalid'), 'true');
    await fill('estimatedValue', '30000.25'); await click('Create opportunity'); await heading('Synthetic Selenium opportunity'); opportunityUrl = await browser().getCurrentUrl();
    await click('Edit opportunity', 'a'); await fill('estimatedValue', '999999999999.99'); await fill('closeDate', '2030-11-03'); await click('Save opportunity'); await contains('EGP 999,999,999,999.99');
    await go('/opportunities'); await click('Edit', 'a'); await fill('opportunityName', 'Must not save'); await click('Cancel'); await heading('Synthetic Selenium opportunity');
    const record = await database!.opportunity.findFirstOrThrow(); assert.equal(record.estimatedValue.toFixed(2), '999999999999.99'); assert.equal(record.closeDate.toISOString().slice(0, 10), '2030-11-03');
  });
  await scenario('Contact filters: name/company/email, combined source/stage, empty and clear', async () => {
    for (const search of ['SELENIUM EXAMPLE', 'Synthetic Edited Studio', 'selenium@example.test']) {
      await go('/contacts'); await fill('search', search); await select('source', 'Website Form'); await select('stage', 'Qualification'); await click('Apply filters'); await contains('1 contact');
    }
    await fill('search', 'no matching fixture'); await click('Apply filters'); await heading('No contacts match these filters');
    await click('Clear filters', 'a'); await contains('Selenium Example');
  });
  await scenario('Dynamic overview: real totals, refresh, pipeline drill-down and global search', async () => {
    await go('/overview'); await heading('A little clarity, a lot of possibility.'); await contains('EGP 999,999,999,999.99');
    await click('Refresh overview'); await browser().wait(until.elementIsEnabled(await element(By.xpath('//button[contains(.,"Refresh overview")]'))), 10_000);
    await screenshot('overview-desktop');
    await browser().findElement(By.css('.pipeline-row[aria-label^="Qualification:"]')).click(); await heading('Contacts'); await contains('1 contact');
    const search = await element(By.css('input[aria-label="Search workspace"]')); await search.sendKeys('Selenium', Key.ENTER); await contains('1 contact');
    await go('/overview'); await browser().findElement(By.css('.upcoming-list a')).click(); await heading('Synthetic Selenium opportunity');
  });
  await scenario('Lead board/table switching, stage filter, empty stage and reset', async () => {
    await go('/leads'); await click('Board view'); await element(By.css('.lead-board')); await contains('Selenium Example');
    await browser().findElement(By.xpath('//select[@aria-label="Filter leads by stage"]/option[normalize-space(.)="Closed Won"]')).click(); await heading('No leads in this stage');
    await click('Show all stages'); await element(By.css('.lead-board')); await click('Table view'); await element(By.css('table')); await contains('Selenium Example');
  });
  await scenario('Failures and loading states: useful message, retry and recovery', async () => {
    await go('/contacts'); failNextRead = true; await fill('search', 'retry-test'); await click('Apply filters'); await contains('Synthetic Selenium request failure.');
    await click('Try again'); await heading('No contacts match these filters');
    delayNextRead = true; await fill('search', 'loading-test'); await click('Apply filters'); await contains('Loading records…'); await heading('No contacts match these filters');
  });
  await scenario('Mobile: navigation, forms, overview and no document overflow at 390px', async () => {
    await (browser() as chrome.Driver).sendDevToolsCommand('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await go('/overview'); await heading('A little clarity, a lot of possibility.');
    assert.ok(await browser().executeScript('return document.documentElement.scrollWidth <= innerWidth + 1'));
    await screenshot('overview-mobile');
    for (const name of ['Contacts', 'Leads', 'Opportunities']) { await browser().findElement(By.xpath(`//nav[@aria-label="Main navigation"]//a[normalize-space(.)="${name}"]`)).click(); await heading(name); }
    await go('/contacts/new'); await click('Cancel'); await heading('Contacts');
    await (browser() as chrome.Driver).sendDevToolsCommand('Emulation.clearDeviceMetricsOverride', {});
  });
  await scenario('Deep-link reload preserves records and sessions; no browser credential storage', async () => {
    assert.ok(contactUrl && opportunityUrl); await browser().get(contactUrl); await browser().navigate().refresh(); await heading('Selenium Example'); await contains('Synthetic Selenium opportunity');
    assert.equal(await browser().executeScript('return localStorage.length + sessionStorage.length'), 0);
  });
  await scenario('Expired session recovery and logout remove record access', async () => {
    await database!.session.deleteMany();
    const search = await element(By.css('input[aria-label="Search workspace"]')); await search.clear(); await search.sendKeys('expire-test', Key.ENTER);
    await contains('Your session expired. Sign in again to continue.'); await signIn();
    await click('Sign out'); await heading('Sign in'); assert.equal(await database!.session.count(), 0);
    assert.equal((await fetch(`${fullUrl}api/contacts`)).status, 401);
  });
  await scenario('Demo: direct entry, fictional label, all navigation and overview', async () => {
    target = demoUrl; await go('/contacts'); await heading('Contacts'); await contains('Fictional data. Changes reset on reload.');
    await go('/overview'); await heading('A little clarity, a lot of possibility.'); await contains('EGP 42,000.25');
    await go('/welcome'); await heading('Less admin.More connection.'); await click('Explore the demo', 'a'); await heading('A little clarity, a lot of possibility.');
  });
  await scenario('Demo: create/edit/contact-lead-opportunity workflow, reset and deep links', async () => {
    await go('/contacts/new');
    for (const [name, value] of Object.entries({ firstName: 'Selenium', lastName: 'Demo', email: 'selenium-demo@example.test', company: 'Synthetic Demo', leadSource: 'Event' })) await fill(name, value);
    await click('Create contact'); await heading('Selenium Demo'); await click('Qualify lead', 'a'); await fill('leadScore', '6'); await click('Create lead');
    await click('Edit lead', 'a'); await select('stage', 'Proposal'); await click('Save lead'); await contains('Proposal');
    await click('Add opportunity', 'a'); await fill('opportunityName', 'Synthetic demo opportunity'); await fill('estimatedValue', '12500.50'); await fill('closeDate', '2028-02-29'); await click('Create opportunity'); await heading('Synthetic demo opportunity');
    await browser().navigate().refresh(); await contains('Back to contacts'); await go('/contacts');
    assert.equal((await browser().findElements(By.xpath('//a[normalize-space(.)="Selenium Demo"]'))).length, 0);
    await click('Mariam Example', 'a'); await browser().navigate().refresh(); await heading('Mariam Example');
    assert.equal(await browser().executeScript('return localStorage.length + sessionStorage.length'), 0);
  });
} catch (error) {
  failures++; cases.push({ name: 'Selenium harness/setup', status: 'FAIL', detail: redact(error instanceof Error ? error.message : 'Setup unavailable') });
  console.error('Selenium setup failed. See the generated Markdown report.');
} finally {
  await driver?.quit();
  for (const host of hosts) await new Promise<void>((done) => host.close(() => done()));
  await sessions?.close(); await database?.$disconnect(); await isolated?.close();
  const markdown = `# Selenium verification report\n\nGenerated: ${new Date().toISOString()}\n\nScope: Chrome, built full/demo targets, disposable synthetic PostgreSQL, desktop and mobile. Production TLS/session flags are covered separately by API and container tests. This is bounded regression coverage, not proof that attacks or undiscovered bugs are impossible.\n\n${cases.filter((item) => item.status === 'PASS').length} passed; ${failures} failed.\n\n| Scenario | Result |\n| --- | --- |\n${cases.map((item) => `| ${item.name} | ${item.status} |`).join('\n')}\n\n## Issues requiring follow-up\n\n${cases.filter((item) => item.status === 'FAIL').map((item, index) => `### SEL-${String(index + 1).padStart(3, '0')}: ${item.name}\n\nExpected: the named workflow completes without interaction errors.\n\nObserved:\n\n\`\`\`text\n${item.detail}\n\`\`\`\n\nReproduce: run \`npm run test:selenium --workspace frontend\` with disposable PostgreSQL available.\n`).join('\n') || 'No failing scenarios in this run. See the versioned security review for residual risks and deployment checks.'}\n\nScreenshots: \`screenshots/landing-desktop.png\`, \`screenshots/overview-desktop.png\`, \`screenshots/overview-mobile.png\`. No password values, session cookies or database URLs are included.\n`;
  await writeFile(resolve(output, 'report.md'), markdown);
  console.info(`Selenium report: frontend/test-results/selenium/report.md (${failures} failures).`);
  if (failures) process.exitCode = 1;
}
