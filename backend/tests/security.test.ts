import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadAuthConfig } from '../src/config.js';
import { createDatabase } from '../src/database.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { createSessionStore } from '../src/modules/auth/session.js';
import { createTelemetry } from '../src/telemetry/http.js';
import { createTestDatabase, runPrisma } from './helpers/database.js';

test('security regression: browser headers, origin/auth boundaries, injection and account revocation', { timeout: 120_000 }, async (suite) => {
  const isolated = await createTestDatabase();
  await runPrisma(['migrate', 'deploy'], isolated.url);
  const database = createDatabase(isolated.url);
  const sessions = createSessionStore(isolated.url);
  const config = loadAuthConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://127.0.0.1:5173', SESSION_SECRET: randomBytes(48).toString('hex') });
  const password = randomBytes(24).toString('base64url');
  const user = await database.user.create({ data: { username: 'security-staff', passwordHash: await hashPassword(password) } });
  const server = createApp({ api: { database, config, store: sessions.store }, telemetry: createTelemetry(() => {}) }).listen(0, '127.0.0.1');
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  let cookie = '';
  async function request(path: string, method = 'GET', body?: unknown, overrides: Record<string, string> = {}) {
    return fetch(base + path, { method, headers: { Origin: config.APP_ORIGIN, 'Content-Type': 'application/json', Cookie: cookie, ...overrides }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  try {
    await suite.test('CSP, anti-framing, MIME-sniffing and permissions headers protect HTTP responses', async () => {
      const response = await request('/health');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.match(response.headers.get('content-security-policy')!, /script-src 'self'/);
      assert.match(response.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
      assert.ok(!response.headers.get('content-security-policy')!.includes('unsafe-inline'));
      assert.ok(!response.headers.has('x-powered-by'));
      assert.match(response.headers.get('permissions-policy')!, /camera=\(\)/);
    });
    await suite.test('forged cookies never authorize collection/item reads or writes', async () => {
      cookie = 'crm.sid=s%3Aattacker-chosen.invalid-signature';
      for (const resource of ['contacts', 'leads', 'opportunities']) {
        for (const [path, method] of [[`/api/${resource}`, 'GET'], [`/api/${resource}`, 'POST'], [`/api/${resource}/${randomUUID()}`, 'GET'], [`/api/${resource}/${randomUUID()}`, 'PATCH']]) {
          assert.equal((await request(path!, method!, method === 'POST' || method === 'PATCH' ? {} : undefined)).status, 401);
        }
      }
    });
    await suite.test('valid login replaces a chosen cookie; identity excludes hashes/session material', async () => {
      const login = await request('/api/auth/login', 'POST', { username: user.username, password });
      assert.equal(login.status, 200);
      const setCookie = login.headers.get('set-cookie')!;
      assert.ok(!setCookie.includes('attacker-chosen'));
      assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Lax/);
      cookie = setCookie.split(';')[0]!;
      const me = await (await request('/api/auth/me')).json() as { data: Record<string, unknown> };
      assert.deepEqual(Object.keys(me.data).sort(), ['id', 'username']);
    });
    await suite.test('null, missing-equivalent and lookalike origins cannot mutate or log a user out', async () => {
      for (const Origin of ['null', '', config.APP_ORIGIN + '.untrusted.example.test', 'https://untrusted.example.test']) {
        for (const path of ['/api/contacts', '/api/auth/logout']) assert.equal((await request(path, 'POST', {}, { Origin })).status, 403);
      }
      assert.equal((await request('/api/auth/me')).status, 200);
    });
    await suite.test('SQL-like searches remain literal; mass assignment and malformed identifiers are rejected', async () => {
      const contact = { firstName: 'Synthetic', lastName: 'Security', email: 'security@example.test', company: 'Synthetic Security Studio', leadSource: 'Test' };
      assert.equal((await request('/api/contacts', 'POST', { ...contact, userId: user.id, isAdmin: true })).status, 400);
      assert.equal((await request('/api/contacts', 'POST', contact)).status, 201);
      const searched = await request('/api/contacts?search=' + encodeURIComponent("' OR 1=1; DROP TABLE Contact;--"));
      assert.equal(searched.status, 200); assert.deepEqual((await searched.json() as { data: unknown[] }).data, []);
      assert.equal(await database.contact.count(), 1);
      assert.equal((await request('/api/contacts/not-a-uuid')).status, 400);
      assert.equal((await request('/api/contacts?search[unexpected]=value')).status, 400);
      const invalid = await request('/api/contacts', 'POST', { privatePassword: password });
      const text = await invalid.text(); assert.ok(!text.includes(password) && !text.includes('Prisma') && !text.includes('stack'));
    });
    await suite.test('revoking an account invalidates its existing authenticated session', async () => {
      await database.user.delete({ where: { id: user.id } });
      assert.equal((await request('/api/auth/me')).status, 401);
      assert.equal((await request('/api/contacts')).status, 401);
    });
  } finally {
    await new Promise<void>((done) => server.close(() => done())); await sessions.close(); await database.$disconnect(); await isolated.close();
  }
});
