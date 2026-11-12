import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadAuthConfig, type AuthConfig } from '../src/config.js';
import { createDatabase } from '../src/database.js';
import { createSessionStore } from '../src/modules/auth/session.js';
import type { serializeContactDetail, serializeContactSummary, serializeLeadDetail, serializeOpportunity } from '../src/modules/serialization.js';
import { backendDirectory, createTestDatabase, runPrisma } from './helpers/database.js';

type ContactDto = ReturnType<typeof serializeContactSummary>;
type LeadDto = ReturnType<typeof serializeLeadDetail>;
type OpportunityDto = ReturnType<typeof serializeOpportunity>;
type UserDto = { id: string; username: string };

async function startApi(database: ReturnType<typeof createDatabase>, url: string, config: AuthConfig) {
  const sessions = createSessionStore(url);
  const app = createApp({
    api: { database, config, store: sessions.store },
    checkDatabase: async () => { await database.$queryRaw`SELECT 1`; },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await sessions.close();
    },
  };
}

function provisionStaff(databaseUrl: string, username: string, password: string) {
  const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
  const script = fileURLToPath(new URL('../scripts/provision-user.ts', import.meta.url));
  return new Promise<void>((resolve, reject) => {
    const child = execFile(process.execPath, [tsxCli, script, '--username', username, '--password-stdin'], {
      cwd: backendDirectory,
      env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
      timeout: 30_000,
    }, (error) => error ? reject(error) : resolve());
    child.stdin?.end(`${password}\n`);
  });
}

function sessionId(cookie: string) {
  const signedValue = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  return signedValue.slice(2, signedValue.lastIndexOf('.'));
}

test('Phase 3 authenticated HTTP workflow', { timeout: 180_000 }, async (suite) => {
  const isolated = await createTestDatabase();
  const database = createDatabase(isolated.url);
  const config = loadAuthConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: randomBytes(48).toString('hex'),
    APP_ORIGIN: 'http://127.0.0.1:5173',
  });
  let api: Awaited<ReturnType<typeof startApi>> | undefined;
  let cookie = '';
  const password = randomBytes(24).toString('base64url');
  const username = 'synthetic-staff';
  let user: UserDto;
  let contact: ContactDto;
  let lead: LeadDto;
  let opportunity: OpportunityDto;

  type RequestOptions = {
    body?: unknown;
    rawBody?: string;
    cookie?: string;
    headers?: Record<string, string>;
    omitOrigin?: boolean;
  };
  async function request<T = never>(method: string, path: string, options: RequestOptions = {}) {
    assert.ok(api);
    const headers: Record<string, string> = { ...options.headers };
    if (!options.omitOrigin && !headers.Origin) headers.Origin = config.APP_ORIGIN;
    const requestCookie = options.cookie ?? cookie;
    if (requestCookie) headers.Cookie = requestCookie;
    let body: string | undefined;
    if (options.body !== undefined || options.rawBody !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = options.rawBody ?? JSON.stringify(options.body);
    }
    const response = await fetch(`${api.url}${path}`, { method, headers, body });
    return {
      status: response.status,
      headers: response.headers,
      body: response.status === 204 ? null : await response.json() as { data: T; error?: { code: string; message: string } },
    };
  }

  async function login(name = username, secret = password, requestCookie = cookie) {
    const result = await request<UserDto>('POST', '/api/auth/login', { cookie: requestCookie, body: { username: name, password: secret } });
    if (result.status === 200) {
      const setCookie = result.headers.get('set-cookie');
      assert.ok(setCookie, 'Successful login sets a session cookie');
      cookie = setCookie.split(';')[0]!;
    }
    return result;
  }

  const newContact = (suffix: string, source = 'Website Form') => ({
    firstName: 'Layla', lastName: suffix, email: `${suffix.toLowerCase()}@example.test`,
    company: 'Synthetic Shared Company', leadSource: source,
  });

  try {
    await runPrisma(['migrate', 'deploy'], isolated.url);
    api = await startApi(database, isolated.url, config);

    await suite.test('staff provisioning hashes passwords and rejects duplicate usernames', async () => {
      await provisionStaff(isolated.url, username.toUpperCase(), password);
      const stored = await database.user.findUniqueOrThrow({ where: { username } });
      assert.ok(stored.passwordHash.startsWith('scrypt$65536$8$2$'));
      assert.ok(stored.passwordHash !== password, 'Database contains a hash');
      await assert.rejects(provisionStaff(isolated.url, username, randomBytes(24).toString('base64url')));
      assert.ok((await database.user.findUniqueOrThrow({ where: { username } })).passwordHash === stored.passwordHash, 'Existing account is preserved');
    });

    await suite.test('every resource collection and item route rejects unauthenticated access', async () => {
      assert.equal((await request('GET', '/api/auth/me')).status, 401);
      for (const resource of ['contacts', 'leads', 'opportunities']) {
        for (const [method, path] of [
          ['GET', `/api/${resource}`], ['GET', `/api/${resource}/${randomUUID()}`],
          ['POST', `/api/${resource}`], ['PATCH', `/api/${resource}/${randomUUID()}`],
        ]) {
          assert.equal((await request(method!, path!, { body: method === 'GET' ? undefined : {} })).status, 401);
        }
      }
      assert.equal(await database.session.count(), 0);
    });

    await suite.test('unsafe requests require the configured origin', async () => {
      const body = { username, password };
      assert.equal((await request('POST', '/api/auth/login', { body, omitOrigin: true })).status, 403);
      for (const origin of ['null', 'https://untrusted.example.test', `${config.APP_ORIGIN}.evil.test`]) {
        assert.equal((await request('POST', '/api/auth/login', { body, headers: { Origin: origin } })).status, 403);
      }
      assert.equal(await database.session.count(), 0);
    });

    await suite.test('login returns a generic failure or an HTTP-only SameSite cookie and public user fields', async () => {
      const failed = await login(username, randomBytes(24).toString('base64url'));
      const unknown = await login('unknown-staff', password);
      assert.equal(failed.status, 401);
      assert.equal(unknown.status, 401);
      assert.deepEqual(failed.body, unknown.body);
      assert.equal(failed.headers.get('set-cookie'), null);
      const signedIn = await login(username.toUpperCase());
      assert.equal(signedIn.status, 200);
      user = signedIn.body!.data;
      assert.deepEqual(Object.keys(user).sort(), ['id', 'username']);
      const header = signedIn.headers.get('set-cookie')!;
      assert.match(header, /HttpOnly/i);
      assert.match(header, /SameSite=Lax/i);
      assert.match(header, /Path=\//i);
      assert.ok(!/; Secure/i.test(header));
      assert.equal((await request<UserDto>('GET', '/api/auth/me')).body!.data.id, user.id);
      const storedSession = await database.session.findUniqueOrThrow({ where: { sid: sessionId(cookie) } });
      assert.equal((storedSession.sess as { userId: string }).userId, user.id);
      assert.ok(storedSession.expire.getTime() > Date.now());
      assert.equal(await database.session.count(), 1);
    });

    await suite.test('login rotates the session and invalidates the previous cookie', async () => {
      const oldCookie = cookie;
      assert.equal((await login()).status, 200);
      assert.ok(cookie !== oldCookie, 'Session identifier rotates');
      assert.equal((await request('GET', '/api/auth/me', { cookie: oldCookie })).status, 401);
      assert.equal(await database.session.count({ where: { sid: sessionId(oldCookie) } }), 0);
      assert.equal((await request('GET', '/api/auth/me')).status, 200);
    });

    await suite.test('contacts support create, detail, list, and PATCH preserving omitted fields', async () => {
      const created = await request<ContactDto>('POST', '/api/contacts', { body: {
        ...newContact('Ahmed'), firstName: ' Layla ', phone: '01000000000', notes: 'Synthetic initial note',
      } });
      assert.equal(created.status, 201);
      contact = created.body!.data;
      assert.equal(created.headers.get('location'), `/api/contacts/${contact.id}`);
      assert.equal(contact.firstName, 'Layla');
      assert.equal(contact.lead, null);
      const edited = await request<ContactDto>('PATCH', `/api/contacts/${contact.id}`, { body: { company: 'Synthetic Edited Company', notes: null } });
      assert.equal(edited.status, 200);
      assert.equal(edited.body!.data.firstName, contact.firstName);
      assert.equal(edited.body!.data.email, contact.email);
      assert.equal(edited.body!.data.phone, contact.phone);
      assert.equal(edited.body!.data.notes, null);
      contact = edited.body!.data;
      assert.equal((await request<ContactDto>('GET', `/api/contacts/${contact.id}`)).body!.data.company, contact.company);
      assert.ok((await request<ContactDto[]>('GET', '/api/contacts')).body!.data.some((item) => item.id === contact.id));
      assert.equal((await request('PATCH', `/api/contacts/${contact.id}`, { body: { notes: 'forbidden' }, headers: { Origin: 'https://untrusted.example.test' } })).status, 403);
      assert.equal((await database.contact.findUniqueOrThrow({ where: { id: contact.id } })).notes, null);
    });

    await suite.test('leads default to Prospecting and preserve the stage when only score is patched', async () => {
      const created = await request<LeadDto>('POST', '/api/leads', { body: { contactId: contact.id, leadScore: 7 } });
      assert.equal(created.status, 201);
      lead = created.body!.data;
      assert.equal(lead.stage, 'Prospecting');
      assert.equal(created.headers.get('location'), `/api/leads/${lead.id}`);
      assert.equal((await request<LeadDto>('PATCH', `/api/leads/${lead.id}`, { body: { stage: 'Qualification' } })).body!.data.leadScore, 7);
      const edited = await request<LeadDto>('PATCH', `/api/leads/${lead.id}`, { body: { leadScore: 9 } });
      assert.equal(edited.status, 200);
      lead = edited.body!.data;
      assert.equal(lead.stage, 'Qualification');
      assert.equal(lead.contactId, contact.id);
      assert.equal((await request<LeadDto>('GET', `/api/leads/${lead.id}`)).body!.data.contact.company, contact.company);
      assert.equal((await request<LeadDto[]>('GET', `/api/leads?contactId=${contact.id}&stage=Qualification`)).body!.data.length, 1);
      const duplicate = await request('POST', '/api/leads', { body: { contactId: contact.id, leadScore: 4 } });
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.body!.error?.code, 'CONFLICT');
    });

    await suite.test('opportunities preserve exact money/date values through create, update, list, and detail', async () => {
      const created = await request<OpportunityDto>('POST', '/api/opportunities', { body: {
        leadId: lead.id, opportunityName: 'Synthetic website', estimatedValue: '30000.2', closeDate: '2028-02-29',
      } });
      assert.equal(created.status, 201);
      opportunity = created.body!.data;
      assert.equal(created.headers.get('location'), `/api/opportunities/${opportunity.id}`);
      assert.equal(opportunity.estimatedValue, '30000.20');
      assert.equal(opportunity.closeDate, '2028-02-29');
      const updated = await request<OpportunityDto>('PATCH', `/api/opportunities/${opportunity.id}`, { body: { estimatedValue: '999999999999.99', closeDate: '2030-01-01' } });
      assert.equal(updated.status, 200);
      const renamed = await request<OpportunityDto>('PATCH', `/api/opportunities/${opportunity.id}`, { body: { opportunityName: 'Synthetic renamed website' } });
      opportunity = renamed.body!.data;
      assert.equal(opportunity.estimatedValue, '999999999999.99');
      assert.equal(opportunity.closeDate, '2030-01-01');
      assert.equal(opportunity.leadId, lead.id);
      assert.equal((await request<OpportunityDto>('GET', `/api/opportunities/${opportunity.id}`)).body!.data.opportunityName, opportunity.opportunityName);
      const second = await request<OpportunityDto>('POST', '/api/opportunities', { body: {
        leadId: lead.id, opportunityName: 'Synthetic discovery', estimatedValue: '0', closeDate: '0001-01-01',
      } });
      assert.equal(second.status, 201);
      assert.equal(second.body!.data.estimatedValue, '0.00');
      assert.equal(second.body!.data.closeDate, '0001-01-01');
      assert.equal((await request<OpportunityDto[]>('GET', `/api/opportunities?leadId=${lead.id}`)).body!.data.length, 2);
      const detail = await request<ReturnType<typeof serializeContactDetail>>('GET', `/api/contacts/${contact.id}`);
      assert.equal(detail.body!.data.lead?.id, lead.id);
      assert.equal(detail.body!.data.lead?.opportunities.length, 2);
      assert.equal(detail.body!.data.lead?.opportunities[1]?.estimatedValue, '999999999999.99');
    });

    await suite.test('search handles full names, company, and email with combined source/stage filtering', async () => {
      const other = (await request<ContactDto>('POST', '/api/contacts', { body: newContact('Other') })).body!.data;
      await request('POST', '/api/leads', { body: { contactId: other.id, leadScore: 5, stage: 'Negotiation' } });
      const referral = (await request<ContactDto>('POST', '/api/contacts', { body: newContact('Referral', 'Referral') })).body!.data;
      await request('POST', '/api/leads', { body: { contactId: referral.id, leadScore: 5, stage: 'Qualification' } });
      const unqualified = (await request<ContactDto>('POST', '/api/contacts', { body: newContact('Unqualified') })).body!.data;
      for (const search of ['LAYLA AHMED', 'synthetic edited company', contact.email.toUpperCase()]) {
        const result = await request<ContactDto[]>('GET', `/api/contacts?${new URLSearchParams({ search, source: 'website form', stage: 'Qualification' })}`);
        assert.equal(result.status, 200);
        assert.deepEqual(result.body!.data.map((item) => item.id), [contact.id]);
      }
      const sourceOnly = await request<ContactDto[]>('GET', '/api/contacts?source=Website%20Form');
      assert.ok(sourceOnly.body!.data.some((item) => item.id === unqualified.id && item.lead === null));
      const combined = await request<ContactDto[]>('GET', '/api/contacts?source=Website%20Form&stage=Qualification');
      assert.deepEqual(combined.body!.data.map((item) => item.id), [contact.id]);
      const stageOnly = await request<ContactDto[]>('GET', '/api/contacts?stage=Qualification');
      assert.equal(stageOnly.body!.data.length, 2);
      const literal = (await request<ContactDto>('POST', '/api/contacts', { body: {
        ...newContact('Literal'), company: 'Synthetic 100%_Company',
      } })).body!.data;
      const literalSearch = await request<ContactDto[]>('GET', `/api/contacts?${new URLSearchParams({ search: '%' })}`);
      assert.deepEqual(literalSearch.body!.data.map((item) => item.id), [literal.id]);
    });

    await suite.test('all six stage labels round-trip through the HTTP API', async () => {
      for (const stage of ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost']) {
        const result = await request<LeadDto>('PATCH', `/api/leads/${lead.id}`, { body: { stage } });
        assert.equal(result.status, 200);
        assert.equal(result.body!.data.stage, stage);
      }
    });

    await suite.test('invalid bodies, identifiers, scores, money, dates, and query parameters return 400', async () => {
      for (const body of [{}, { firstName: ' ' }, { ...newContact('Invalid'), email: 'invalid' }, { ...newContact('Unexpected'), userId: user.id }]) {
        assert.equal((await request('POST', '/api/contacts', { body })).status, 400);
      }
      for (const resource of ['contacts', 'leads', 'opportunities']) {
        assert.equal((await request('GET', `/api/${resource}/invalid-id`)).status, 400);
      }
      assert.equal((await request('PATCH', `/api/contacts/${contact.id}`, { body: {} })).status, 400);
      assert.equal((await request('PATCH', `/api/leads/${lead.id}`, { body: {} })).status, 400);
      assert.equal((await request('PATCH', `/api/opportunities/${opportunity.id}`, { body: {} })).status, 400);
      for (const leadScore of [0, 11, 1.5, '7', null]) {
        assert.equal((await request('PATCH', `/api/leads/${lead.id}`, { body: { leadScore } })).status, 400);
      }
      assert.equal((await request('PATCH', `/api/leads/${lead.id}`, { body: { stage: 'ClosedWon' } })).status, 400);
      for (const estimatedValue of [3, '-0.01', 'NaN', 'Infinity', '1e3', '+1', '01.00', '1.234', '1000000000000.00']) {
        assert.equal((await request('PATCH', `/api/opportunities/${opportunity.id}`, { body: { estimatedValue } })).status, 400);
      }
      for (const closeDate of ['2027-02-29', '2028-13-01', '0000-01-01', '2028-02-29T00:00:00Z', '29/02/2028']) {
        assert.equal((await request('PATCH', `/api/opportunities/${opportunity.id}`, { body: { closeDate } })).status, 400);
      }
      for (const path of ['/api/contacts?stage=Unknown', '/api/contacts?search=a&search=b', '/api/contacts?unexpected=x', '/api/leads?contactId=bad', '/api/opportunities?leadId=bad']) {
        assert.equal((await request('GET', path)).status, 400);
      }
      assert.equal((await request('GET', `/api/contacts/${contact.id}?unexpected=x`)).status, 400);
      assert.equal((await request('POST', '/api/contacts?unexpected=x', { body: newContact('BadQuery') })).status, 400);
      const malformed = await request('POST', '/api/contacts', { rawBody: '{' });
      assert.equal(malformed.status, 400);
      assert.equal(malformed.body!.error?.code, 'INVALID_JSON');
      assert.equal((await request('PATCH', `/api/contacts/${contact.id}`, { body: { notes: 'x'.repeat(110_000) } })).status, 413);
      assert.equal((await request<OpportunityDto>('GET', `/api/opportunities/${opportunity.id}`)).body!.data.estimatedValue, opportunity.estimatedValue);
    });

    await suite.test('missing records and parents return 404 without changing relationships', async () => {
      for (const resource of ['contacts', 'leads', 'opportunities']) {
        assert.equal((await request('GET', `/api/${resource}/${randomUUID()}`)).status, 404);
      }
      assert.equal((await request('PATCH', `/api/contacts/${randomUUID()}`, { body: { notes: 'missing' } })).status, 404);
      assert.equal((await request('PATCH', `/api/leads/${randomUUID()}`, { body: { leadScore: 5 } })).status, 404);
      assert.equal((await request('PATCH', `/api/opportunities/${randomUUID()}`, { body: { estimatedValue: '1' } })).status, 404);
      assert.equal((await request('POST', '/api/leads', { body: { contactId: randomUUID(), leadScore: 5 } })).status, 404);
      assert.equal((await request('POST', '/api/opportunities', { body: { leadId: randomUUID(), opportunityName: 'Missing parent', estimatedValue: '1', closeDate: '2028-01-01' } })).status, 404);
      assert.equal((await request('PATCH', `/api/leads/${lead.id}`, { body: { contactId: randomUUID() } })).status, 404);
      assert.equal((await request('PATCH', `/api/opportunities/${opportunity.id}`, { body: { leadId: randomUUID() } })).status, 404);
      assert.equal((await request<LeadDto>('GET', `/api/leads/${lead.id}`)).body!.data.contactId, contact.id);
      assert.equal((await request<OpportunityDto>('GET', `/api/opportunities/${opportunity.id}`)).body!.data.leadId, lead.id);
    });

    await suite.test('concurrent duplicate lead creation produces one 201 and one 409', async () => {
      const parent = (await request<ContactDto>('POST', '/api/contacts', { body: newContact('Concurrent') })).body!.data;
      const results = await Promise.all([
        request('POST', '/api/leads', { body: { contactId: parent.id, leadScore: 3 } }),
        request('POST', '/api/leads', { body: { contactId: parent.id, leadScore: 4 } }),
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      assert.equal(await database.lead.count({ where: { contactId: parent.id } }), 1);
      assert.equal((await request('PATCH', `/api/leads/${lead.id}`, { body: { contactId: parent.id } })).status, 409);
    });

    await suite.test('a session survives application and session-store restart', async () => {
      await api!.close();
      api = await startApi(database, isolated.url, config);
      assert.equal((await request<UserDto>('GET', '/api/auth/me')).body!.data.id, user.id);
    });

    await suite.test('staff accounts share records', async () => {
      const secondPassword = randomBytes(24).toString('base64url');
      await provisionStaff(isolated.url, 'shared-staff', secondPassword);
      const mainCookie = cookie;
      const result = await login('shared-staff', secondPassword, '');
      assert.equal(result.status, 200);
      assert.ok(result.body!.data.id !== user.id);
      assert.equal((await request<ContactDto>('GET', `/api/contacts/${contact.id}`)).body!.data.id, contact.id);
      assert.equal((await request('POST', '/api/auth/logout')).status, 204);
      cookie = mainCookie;
      assert.equal((await request('GET', '/api/auth/me')).status, 200);
    });

    await suite.test('expired sessions are rejected and logout destroys the stored session', async () => {
      const expiredCookie = cookie;
      await database.session.update({ where: { sid: sessionId(cookie) }, data: { expire: new Date('2000-01-01T00:00:00.000Z') } });
      assert.equal((await request('GET', '/api/auth/me')).status, 401);
      assert.equal((await login()).status, 200);
      assert.equal((await request('GET', '/api/auth/me', { cookie: expiredCookie })).status, 401);
      const loggedOutCookie = cookie;
      const logout = await request('POST', '/api/auth/logout');
      assert.equal(logout.status, 204);
      assert.match(logout.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/i);
      assert.equal(await database.session.count({ where: { sid: sessionId(loggedOutCookie) } }), 0);
      assert.equal((await request('GET', '/api/auth/me', { cookie: loggedOutCookie })).status, 401);
      cookie = '';
      assert.equal((await request('POST', '/api/auth/logout')).status, 204);
    });

    await suite.test('production HTTPS cookies are Secure behind the explicitly trusted proxy', async () => {
      const productionConfig = loadAuthConfig({ NODE_ENV: 'production', SESSION_SECRET: randomBytes(48).toString('hex'), APP_ORIGIN: 'https://crm.example.test', TRUST_PROXY_HOPS: '1' });
      const production = await startApi(database, isolated.url, productionConfig);
      try {
        const response = await fetch(`${production.url}/api/auth/login`, {
          method: 'POST',
          headers: { Origin: productionConfig.APP_ORIGIN, 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        assert.equal(response.status, 200);
        const header = response.headers.get('set-cookie')!;
        assert.match(header, /; Secure/i);
        assert.match(header, /HttpOnly/i);
        assert.match(header, /SameSite=Lax/i);
      } finally {
        await production.close();
      }
      assert.throws(() => loadAuthConfig({ NODE_ENV: 'production', SESSION_SECRET: randomBytes(48).toString('hex'), APP_ORIGIN: 'http://example.test' }), /Invalid authentication configuration/);
      assert.throws(() => loadAuthConfig({ SESSION_SECRET: 'short' }), /Invalid authentication configuration/);
    });

    await suite.test('login is rate limited per IP with a retry response', async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        assert.equal((await login('unknown-staff', password, '')).status, 401);
      }
      const limited = await login(username, password, '');
      assert.equal(limited.status, 429);
      assert.equal(limited.body!.error?.code, 'RATE_LIMITED');
      assert.ok(limited.headers.get('retry-after'));
    });
  } finally {
    await api?.close();
    await database.$disconnect();
    await isolated.close();
  }
});
