import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/middleware/errors.js';
import { createTelemetry, createMetricsServer, routeTemplate } from '../src/telemetry/http.js';
import { loadConfig } from '../src/config.js';

test('telemetry masks route values, generates request IDs, and keeps secrets out of logs/metrics', async () => {
  const lines: string[] = [];
  const telemetry = createTelemetry((line) => { lines.push(line); });
  const app = express();
  app.use(telemetry.middleware, express.json());
  app.get('/api/contacts/:id', (_request, response) => { response.json({ data: {} }); });
  app.post('/api/auth/login', () => { throw new Error('private-password private-contact private-session'); });
  app.get('/ready', (_request, response) => { response.sendStatus(503); });
  app.use((_request, response) => { response.sendStatus(404); });
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  const metrics = createMetricsServer(telemetry.registry).listen(0, '127.0.0.1');
  await Promise.all([once(server, 'listening'), once(metrics, 'listening')]);
  const address = server.address();
  const monitorAddress = metrics.address();
  assert.ok(address && typeof address !== 'string' && monitorAddress && typeof monitorAddress !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${origin}/api/contacts/private-contact?email=private-email`, {
      headers: { 'X-Request-ID': 'private-session', Cookie: 'crm.sid=private-session', Authorization: 'private-password' },
    });
    assert.match(response.headers.get('x-request-id')!, /^[0-9a-f-]{36}$/);
    assert.equal((await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'private-password', email: 'private-email' }) })).status, 500);
    await fetch(`${origin}/api/private-contact/private-email/private-session`);
    await fetch(`${origin}/ready`);
    const scrape = await fetch(`http://127.0.0.1:${monitorAddress.port}/metrics`);
    assert.equal(scrape.status, 200);
    const text = await scrape.text();
    assert.match(text, /route="\/api\/contacts\/:id"/);
    assert.match(text, /status_code="500"/);
    assert.ok(!text.includes('/ready'), 'Readiness probes do not affect API metrics');
    for (const secret of ['private-password', 'private-contact', 'private-session', 'private-email']) {
      assert.ok(!text.includes(secret));
      assert.ok(!lines.join('').includes(secret));
    }
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(records.length, 4);
    assert.equal(records[0]!.request_id, response.headers.get('x-request-id'));
    assert.ok(records.every((record) => Object.keys(record).sort().join(',') === 'duration_ms,event,level,method,request_id,route,status_code,time'));
    assert.equal(new Set(records.map((record) => record.request_id)).size, records.length);
    assert.equal((await fetch(`${origin}/metrics`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${monitorAddress.port}/api/contacts`)).status, 404);
  } finally {
    await Promise.all([server, metrics].map((listener) => new Promise<void>((done) => listener.close(() => done()))));
  }
});

test('the public app never serves its metrics registry', async () => {
  const app = createApp({ telemetry: createTelemetry(() => {}) });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { assert.equal((await fetch(`http://127.0.0.1:${address.port}/metrics`)).status, 404); }
  finally { await new Promise<void>((done) => server.close(() => done())); }
});

test('templates and monitoring startup settings are bounded and separate', () => {
  assert.equal(routeTemplate('/api/leads/secret-uuid'), '/api/leads/:id');
  assert.equal(routeTemplate('/API/Contacts/secret-uuid'), '/api/contacts/:id');
  assert.equal(routeTemplate('/api/opportunities/secret-uuid/'), '/api/opportunities/:id');
  assert.equal(routeTemplate('/api/unrecognized/secret-value'), 'unmatched');
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgresql://fixture:fixture@localhost/crm', PORT: '3000', METRICS_PORT: '3000' }));
  assert.equal(loadConfig({ DATABASE_URL: 'postgresql://fixture:fixture@localhost/crm' }).METRICS_HOST, '127.0.0.1');
});
