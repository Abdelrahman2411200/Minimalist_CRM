import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import express from 'express';
import { config as loadEnvironment } from 'dotenv';
import { chromium, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { createApp } from '../../backend/src/app';
import { loadAuthConfig } from '../../backend/src/config';
import { createDatabase } from '../../backend/src/database';
import { hashPassword } from '../../backend/src/modules/auth/password';
import { createSessionStore } from '../../backend/src/modules/auth/session';
import { createTestDatabase, runPrisma } from '../../backend/tests/helpers/database';

loadEnvironment({ path: fileURLToPath(new URL('../../backend/.env', import.meta.url)), quiet: true });
const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const resultsDirectory = resolve(frontendRoot, 'test-results');

async function buildTarget(mode: 'full' | 'demo') {
  const outDir = resolve(resultsDirectory, mode);
  assert.ok(outDir.startsWith(`${resultsDirectory}${sep}`));
  const previousBase = process.env.VITE_BASE_PATH;
  const previousLink = process.env.VITE_FULL_CRM_URL;
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.env.VITE_BASE_PATH = mode === 'demo' ? '/portfolio/' : '/';
  process.env.VITE_FULL_CRM_URL = mode === 'demo' ? 'https://crm.example.test' : '';
  try {
    await build({ root: frontendRoot, mode, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  } finally {
    if (previousBase === undefined) delete process.env.VITE_BASE_PATH;
    else process.env.VITE_BASE_PATH = previousBase;
    if (previousLink === undefined) delete process.env.VITE_FULL_CRM_URL;
    else process.env.VITE_FULL_CRM_URL = previousLink;
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnvironment;
  }
  return outDir;
}

async function startHost(outDir: string | undefined, base = '/') {
  const app = express();
  if (outDir) app.use(base, express.static(outDir));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    app,
    origin: `http://127.0.0.1:${address.port}`,
    url: `http://127.0.0.1:${address.port}${base}`,
    close: () => new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())),
  };
}

async function signIn(page: Page, password: string) {
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Username', { exact: true }).fill('browser-staff');
  try {
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  } catch {
    const input = page.getByLabel('Password', { exact: true });
    if (await input.count()) await input.fill('').catch(() => {});
    throw new Error('Synthetic sign-in did not reach the dashboard');
  }
}

async function contactsTab(page: Page) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Contacts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contacts', exact: true })).toBeVisible();
}

async function salesWorkflow(page: Page) {
  await contactsTab(page);
  await page.getByRole('link', { name: 'Add contact', exact: true }).first().click();
  await page.getByRole('button', { name: 'Create contact', exact: true }).click();
  await expect(page.getByLabel('First name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('First name', { exact: true }).fill('Vera');
  await page.getByLabel('Last name', { exact: true }).fill('Workflow');
  await page.getByLabel('Email', { exact: true }).fill('vera@example.test');
  await page.getByLabel('Company', { exact: true }).fill('Synthetic Browser Company');
  await page.getByLabel('Lead source', { exact: true }).fill('Website Form');
  await page.getByLabel('Phone (optional)', { exact: true }).fill('01000000000');
  await page.getByLabel('Notes (optional)', { exact: true }).fill('Synthetic browser notes\nSecond line');
  await page.getByRole('button', { name: 'Create contact', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vera Workflow', exact: true })).toBeVisible();
  const contactUrl = page.url();
  await page.getByRole('link', { name: 'Edit contact', exact: true }).click();
  await expect(page.getByLabel('Notes (optional)', { exact: true })).toHaveValue('Synthetic browser notes\nSecond line');
  await page.getByLabel('Company', { exact: true }).fill('Synthetic Updated Company');
  await page.getByRole('button', { name: 'Save contact', exact: true }).click();
  await expect(page.getByText('Synthetic Updated Company', { exact: true })).toBeVisible();
  await expect(page.getByText('01000000000', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Qualify lead', exact: true }).click();
  await page.getByLabel('Lead score (1–10)', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Create lead', exact: true }).click();
  await expect(page.getByText('Prospecting', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit lead', exact: true }).click();
  await page.getByLabel('Lead score (1–10)', { exact: true }).fill('9');
  await page.getByLabel('Stage', { exact: true }).selectOption('Qualification');
  await page.getByRole('button', { name: 'Save lead', exact: true }).click();
  await expect(page.getByText('9 / 10', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Add opportunity', exact: true }).click();
  await page.getByLabel('Opportunity name', { exact: true }).fill('Synthetic browser opportunity');
  await page.getByLabel('Estimated value (EGP)', { exact: true }).fill('1.234');
  await page.getByLabel('Expected close date', { exact: true }).fill('2028-02-29');
  await page.getByRole('button', { name: 'Create opportunity', exact: true }).click();
  await expect(page.getByLabel('Estimated value (EGP)', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Estimated value (EGP)', { exact: true }).fill('30000.25');
  await page.getByRole('button', { name: 'Create opportunity', exact: true }).click();
  await expect(page.getByText('EGP 30,000.25', { exact: true })).toBeVisible();
  await expect(page.getByText('29 Feb 2028', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit opportunity', exact: true }).click();
  await expect(page.getByLabel('Estimated value (EGP)', { exact: true })).toHaveValue('30000.25');
  await expect(page.getByLabel('Expected close date', { exact: true })).toHaveValue('2028-02-29');
  await page.getByLabel('Estimated value (EGP)', { exact: true }).fill('999999999999.99');
  await page.getByLabel('Expected close date', { exact: true }).fill('2030-11-03');
  await page.getByRole('button', { name: 'Save opportunity', exact: true }).click();
  await expect(page.getByText('EGP 999,999,999,999.99', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit opportunity', exact: true }).click();
  await page.getByLabel('Opportunity name', { exact: true }).fill('Synthetic edited opportunity');
  await page.getByRole('button', { name: 'Save opportunity', exact: true }).click();
  await expect(page.getByText('EGP 999,999,999,999.99', { exact: true })).toBeVisible();
  await expect(page.getByText('3 Nov 2030', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View contact and sales history', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Synthetic edited opportunity', exact: true })).toBeVisible();
  await expect(page.getByText('Qualification', { exact: true })).toBeVisible();
  await contactsTab(page);
  await page.getByLabel('Search contacts', { exact: true }).fill('VERA WORKFLOW');
  await page.getByLabel('Lead source', { exact: true }).selectOption('Website Form');
  await page.getByLabel('Lead stage', { exact: true }).selectOption('Qualification');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page).toHaveURL((url) => {
    const filters = new URLSearchParams(url.hash.split('?')[1]);
    return filters.get('search') === 'VERA WORKFLOW' && filters.get('source') === 'Website Form' && filters.get('stage') === 'Qualification';
  });
  await expect(page.getByRole('link', { name: 'Vera Workflow', exact: true })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(2);
  await page.getByLabel('Search contacts', { exact: true }).fill('No matching synthetic name');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No contacts match these filters' })).toBeVisible();
  await page.getByRole('link', { name: 'Clear filters', exact: true }).first().click();
  await page.getByRole('link', { name: 'Vera Workflow', exact: true }).click();
  return contactUrl;
}

test('built demo runs under a repository path without CRM requests and resets on reload', { timeout: 180_000 }, async (suite) => {
  const outDir = await buildTarget('demo');
  const assets = await readdir(resolve(outDir, 'assets'));
  const javascript = (await Promise.all(assets.filter((file) => file.endsWith('.js')).map((file) => readFile(resolve(outDir, 'assets', file), 'utf8')))).join('\n');
  assert.ok(!javascript.includes('/auth/login') && !javascript.includes('/auth/me'), 'Demo artifact excludes the HTTP adapter');
  const host = await startHost(outDir, '/portfolio/');
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Pacific/Honolulu' });
    const page = await context.newPage();
    const errors: Error[] = [];
    let apiRequests = 0;
    page.on('pageerror', (error) => errors.push(error));
    page.on('request', (request) => { if (/\/api(?:\/|$)/.test(new URL(request.url()).pathname)) apiRequests++; });
    await page.goto(`${host.url}#/contacts`);
    await expect(page.getByText('Fictional data. Changes reset on reload.', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open full CRM' })).toHaveAttribute('href', 'https://crm.example.test');
    await suite.test('demo contact, lead, and opportunity workflow with edits and combined filters', async () => {
      await salesWorkflow(page);
      await page.screenshot({ path: resolve(resultsDirectory, 'demo-desktop.png'), fullPage: true });
    });
    await suite.test('fixture deep links reload and demo edits reset', async () => {
      await contactsTab(page);
      await page.getByRole('link', { name: 'Mariam Example', exact: true }).click();
      const url = page.url();
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Mariam Example', exact: true })).toBeVisible();
      assert.equal(page.url(), url);
      await contactsTab(page);
      await expect(page.getByRole('link', { name: 'Vera Workflow', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Mariam Example', exact: true })).toBeVisible();
    });
    await suite.test('mobile navigation and forms fit the viewport', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('navigation').getByRole('link', { name: 'Opportunities', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Opportunities', exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Add opportunity', exact: true }).click();
      await expect(page.getByLabel('Opportunity name')).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({ path: resolve(resultsDirectory, 'demo-mobile.png'), fullPage: true });
    });
    assert.equal(apiRequests, 0);
    assert.equal(errors.length, 0, 'Demo has no uncaught browser errors');
  } finally {
    await browser?.close();
    await host.close();
  }
});

test('built full dashboard completes the authenticated workflow against isolated PostgreSQL', { timeout: 240_000 }, async (suite) => {
  const isolated = await createTestDatabase();
  const database = createDatabase(isolated.url);
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let sessions: ReturnType<typeof createSessionStore> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await runPrisma(['migrate', 'deploy'], isolated.url);
    const password = randomBytes(24).toString('base64url');
    await database.user.create({ data: { username: 'browser-staff', passwordHash: await hashPassword(password) } });
    const frontendDirectory = await buildTarget('full');
    host = await startHost(undefined);
    sessions = createSessionStore(isolated.url);
    const config = loadAuthConfig({ NODE_ENV: 'test', SESSION_SECRET: randomBytes(48).toString('hex'), APP_ORIGIN: host.origin });
    host.app.use(createApp({
      frontendDirectory,
      api: { database, config, store: sessions.store },
      checkDatabase: async () => { await database.$queryRaw`SELECT 1`; },
    }));
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Africa/Cairo' });
    const page = await context.newPage();
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    let signedIn = false;
    await page.goto(`${host.url}#/contacts`);
    await suite.test('sign-in failure and success use the server session', async () => {
      await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByLabel('Username', { exact: true })).toHaveAttribute('aria-invalid', 'true');
      await page.getByLabel('Username').fill('browser-staff');
      await page.getByLabel('Password', { exact: true }).fill('synthetic-invalid-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Invalid username or password');
      await signIn(page, password);
      await expect(page.getByRole('heading', { name: 'Your contacts start here' })).toBeVisible();
      const cookies = await context.cookies();
      assert.ok(cookies.some((cookie) => cookie.name === 'crm.sid' && cookie.httpOnly));
      signedIn = true;
    });
    assert.ok(signedIn, 'Sign-in must complete before workflow tests');
    let workflowCompleted = false;
    await suite.test('full contact, lead, and opportunity workflow with field preservation and filters', async () => {
      await salesWorkflow(page);
      const url = page.url();
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Vera Workflow', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Synthetic edited opportunity', exact: true })).toBeVisible();
      assert.equal(page.url(), url);
      const opportunity = await database.opportunity.findFirstOrThrow();
      assert.equal(opportunity.estimatedValue.toFixed(2), '999999999999.99');
      assert.equal(opportunity.closeDate.toISOString().slice(0, 10), '2030-11-03');
      workflowCompleted = true;
    });
    assert.ok(workflowCompleted, 'Sales workflow must complete before session-state tests');
    await suite.test('failed requests offer retry and loading is announced', async () => {
      await contactsTab(page);
      await page.route((url) => url.pathname === '/api/contacts' && url.searchParams.get('search') === 'failure', (route) => route.fulfill({
        status: 500, json: { error: { code: 'TEST_FAILURE', message: 'Synthetic request failure.' } },
      }), { times: 1 });
      await page.getByLabel('Search contacts').fill('failure');
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Synthetic request failure.');
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'No contacts match these filters' })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      let release = () => {};
      const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
      await page.route((url) => url.pathname === '/api/contacts' && url.searchParams.get('search') === 'loading', async (route) => {
        await gate;
        await route.continue();
      }, { times: 1 });
      try {
        await page.getByLabel('Search contacts').fill('loading');
        await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
        await expect(page.getByText('Loading records…', { exact: true })).toBeVisible();
      } finally { release(); }
      await expect(page.getByRole('heading', { name: 'No contacts match these filters' })).toBeVisible();
    });
    await suite.test('expired sessions return to sign-in and support signing in again', async () => {
      await database.session.deleteMany();
      await page.getByLabel('Search contacts').fill('expired');
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
      await expect(page.getByText('Your session expired. Sign in again to continue.', { exact: true })).toBeVisible();
      await signIn(page, password);
      await contactsTab(page);
      await expect(page.getByRole('link', { name: 'Vera Workflow', exact: true })).toBeVisible();
    });
    await suite.test('sign out clears the authenticated dashboard', async () => {
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
      assert.equal(await database.session.count(), 0);
    });
    assert.equal(errors.length, 0, 'Full dashboard has no uncaught browser errors');
  } finally {
    await browser?.close();
    await host?.close();
    await sessions?.close();
    await database.$disconnect();
    await isolated.close();
  }
});
