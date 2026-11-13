import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { fixtureContacts } from '../src/data/fixtures';
import { contactsTab, salesWorkflow } from './helpers/sales-workflow';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const artifact = resolve(frontendRoot, 'dist');
const hostedUrl = process.env.PAGES_URL;
const base = hostedUrl ? new URL(hostedUrl).pathname : process.env.VITE_BASE_PATH || '/portfolio/';
assert.ok(base.startsWith('/') && base.endsWith('/') && !base.startsWith('//'), 'Use a base path with leading/trailing slashes');

async function staticFiles(directory: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Pages artifact must not contain links');
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) result.push(...await staticFiles(resolve(directory, entry.name), `${name}/`));
    else result.push(name);
  }
  return result;
}

test('Pages artifact contains static demo output only', { skip: !!hostedUrl }, async () => {
  const files = await staticFiles(artifact);
  assert.ok(files.includes('index.html'), 'Build the demo before testing the artifact');
  assert.ok(files.some((name) => name.endsWith('.js')));
  for (const name of files) {
    assert.match(name, /^(index\.html|assets\/[A-Za-z0-9_.-]+\.(js|css|svg|png|webp|woff2?))$/, `Unexpected artifact file: ${name}`);
    assert.ok(!name.endsWith('.map'), 'Source maps are excluded');
  }
  const text = (await Promise.all(files.filter((name) => /\.(html|js|css)$/.test(name)).map((name) => readFile(resolve(artifact, name), 'utf8')))).join('\n');
  for (const marker of ['/auth/login', '/auth/me', 'DATABASE_URL', 'SESSION_SECRET', 'postgresql://']) {
    assert.ok(!text.includes(marker), 'Demo excludes the HTTP adapter and server configuration');
  }
  assert.ok(fixtureContacts.every((contact) => contact.email.endsWith('@example.test')), 'Only reserved fictional fixture email addresses');
});

test('Pages demo serves assets, supports sales workflows and deep-link refresh without API requests', { timeout: 120_000 }, async (suite) => {
  let server: ReturnType<ReturnType<typeof express>['listen']> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let url = hostedUrl;
  try {
    if (!url) {
      const app = express();
      app.use(base, express.static(artifact));
      server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      url = `http://127.0.0.1:${address.port}${base}`;
    }
    const target = new URL(url);
    assert.ok(target.protocol === 'https:' || (target.protocol === 'http:' && target.hostname === '127.0.0.1'));
    assert.ok(!target.username && !target.password && !target.search && !target.hash, 'PAGES_URL must be a public site base URL');
    assert.ok(target.pathname.endsWith('/'), 'PAGES_URL needs its trailing slash');
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Africa/Cairo' });
    const page = await context.newPage();
    const apiRequests: string[] = [];
    const dataRequests: string[] = [];
    const failedResponses: string[] = [];
    const errors: Error[] = [];
    const loadedAssets = new Set<string>();
    page.on('request', (request) => {
      if (/\/api(?:\/|$)/.test(new URL(request.url()).pathname)) apiRequests.push(request.url());
      if (['fetch', 'xhr'].includes(request.resourceType())) dataRequests.push(request.url());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) failedResponses.push(response.url());
      if (response.ok() && /\.(js|css)$/.test(new URL(response.url()).pathname)) loadedAssets.add(response.url());
    });
    page.on('pageerror', (error) => errors.push(error));
    const response = await page.goto(`${target.href}#/contacts`);
    assert.equal(response?.status(), 200);

    await suite.test('demo starts directly and JS/CSS assets load under the intended base', async () => {
      await expect(page.getByRole('heading', { name: 'Contacts', exact: true })).toBeVisible();
      await expect(page.getByText('Fictional data. Changes reset on reload.', { exact: false })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCount(0);
      const assets = await page.locator('script[src], link[rel="stylesheet"]').evaluateAll((nodes) => nodes.map((node) =>
        node.tagName === 'SCRIPT' ? (node as HTMLScriptElement).src : (node as HTMLLinkElement).href));
      assert.ok(assets.some((asset) => asset.endsWith('.js')) && assets.some((asset) => asset.endsWith('.css')));
      for (const asset of assets) {
        assert.ok(asset.startsWith(`${target.origin}${base}assets/`), 'Asset URL stays under the Pages base');
        assert.ok(loadedAssets.has(asset), 'Asset returned a successful response');
      }
      const link = page.getByRole('link', { name: 'Open full CRM' });
      if (process.env.VITE_FULL_CRM_URL !== undefined) {
        if (process.env.VITE_FULL_CRM_URL) await expect(link).toHaveAttribute('href', process.env.VITE_FULL_CRM_URL);
        else await expect(link).toHaveCount(0);
      }
      if (await link.count()) {
        const fullUrl = new URL((await link.getAttribute('href'))!);
        assert.ok(['http:', 'https:'].includes(fullUrl.protocol) && !fullUrl.username && !fullUrl.password);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      }
    });
    await suite.test('complete contact-to-opportunity workflow supports edits, validation and combined filters', async () => {
      await salesWorkflow(page);
    });
    await suite.test('fixture detail deep links refresh and browser-memory changes reset', async () => {
      await contactsTab(page);
      await page.getByRole('link', { name: 'Mariam Example', exact: true }).click();
      const detailUrl = page.url();
      assert.equal((await page.reload())?.status(), 200);
      await expect(page.getByRole('heading', { name: 'Mariam Example', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Synthetic website project', exact: true })).toBeVisible();
      assert.equal(page.url(), detailUrl);
      await contactsTab(page);
      await expect(page.getByRole('link', { name: 'Vera Workflow', exact: true })).toHaveCount(0);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      assert.equal((await context.cookies()).length, 0);
    });
    assert.equal(apiRequests.length, 0, 'Zero CRM API requests across initial load, workflow and refresh');
    assert.equal(dataRequests.length, 0, 'Zero fetch/XHR requests');
    assert.equal(failedResponses.length, 0, 'No failed document or asset responses');
    assert.equal(errors.length, 0, 'No uncaught browser errors');
    await mkdir(resolve(frontendRoot, 'test-results'), { recursive: true });
    await page.screenshot({ path: resolve(frontendRoot, 'test-results', 'pages-desktop.png'), fullPage: true });
    console.info(`Verified ${target.href}: ${loadedAssets.size} JS/CSS assets, zero API/fetch/XHR requests.`);
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done()));
  }
});
