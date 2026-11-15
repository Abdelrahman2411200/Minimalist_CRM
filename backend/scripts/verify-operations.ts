import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

type Result = { output: string; code: number };
type Command = (args: string[], input?: string, allowFailure?: boolean) => Promise<Result>;
type Request = (path: string, method?: string, body?: unknown, headers?: Record<string, string>) => Promise<{
  status: number; body: Record<string, unknown>;
}>;
type Context = {
  compose: Command; docker: Command; request: Request; ready: () => Promise<void>;
  controller: (args: string[]) => Promise<Result>;
  execute: (command: string, args: string[], input?: string, allowFailure?: boolean) => Promise<Result>;
  python: string; deployDirectory: string; environmentFile: string; directory: string; project: string;
  prometheusPort: number; grafanaPort: number; grafanaPassword: string; contactId: string; password: string; cookie: string;
};

async function waitFor(check: () => Promise<boolean>, description: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if (await check()) return; } catch { /* service is starting or waiting for the next scrape */ }
    await delay(1_000);
  }
  throw new Error(description);
}

export async function verifyMonitoring(context: Context) {
  const { compose, docker, request, project, controller } = context;
  console.info('Starting private Prometheus/Grafana and waiting for a successful API scrape...');
  await controller(['monitoring']);
  const prometheus = `http://127.0.0.1:${context.prometheusPort}`;
  const grafana = `http://127.0.0.1:${context.grafanaPort}`;
  const authorization = `Basic ${Buffer.from(`admin:${context.grafanaPassword}`).toString('base64')}`;
  await waitFor(async () => (await fetch(`${prometheus}/-/ready`)).ok && (await fetch(`${grafana}/api/health`)).ok,
    'Private monitoring services did not become ready');
  await waitFor(async () => {
    const result = await (await fetch(`${prometheus}/api/v1/targets`)).json() as { data: { activeTargets: { health: string }[] } };
    return result.data.activeTargets.some((target) => target.health === 'up');
  }, 'Prometheus did not scrape the private API listener');
  console.info('Private monitoring is ready and Prometheus reports the API target up.');

  for (const path of ['/metrics', '/metrics/private', '/api/metrics', '/grafana', '/grafana/login', '/prometheus', '/monitoring', '/api/v1/query', '/-/ready']) {
    assert.equal((await request(path)).status, 404, `Public proxy denies ${path}`);
  }
  for (const service of ['prometheus', 'grafana']) {
    const id = (await compose(['ps', '-q', service])).output.trim();
    const info = JSON.parse((await docker(['inspect', id])).output)[0] as {
      NetworkSettings: { Ports: Record<string, { HostIp: string }[] | null>; Networks: Record<string, unknown> };
    };
    assert.deepEqual(Object.keys(info.NetworkSettings.Networks).sort(), [`${project}_monitoring`, `${project}_monitoring_access`].sort());
    assert.ok(Object.values(info.NetworkSettings.Ports).some((bindings) => bindings && bindings.length > 0), 'Loopback monitoring port is actually published');
    for (const bindings of Object.values(info.NetworkSettings.Ports)) {
      assert.ok(!bindings || bindings.every((binding) => binding.HostIp === '127.0.0.1'));
    }
  }
  const proxy = JSON.parse((await docker(['inspect', (await compose(['ps', '-q', 'proxy'])).output.trim()])).output)[0] as {
    NetworkSettings: { Networks: Record<string, unknown> };
  };
  assert.ok(!Object.keys(proxy.NetworkSettings.Networks).includes(`${project}_monitoring`));

  // Actual API samples populate all three provisioned panels; failures affect only this disposable stack.
  const probe = 'private-log-probe@example.test';
  await request(`/api/contacts?search=${encodeURIComponent(probe)}`, 'GET', undefined, { 'X-Request-ID': probe });
  for (let index = 0; index < 20; index++) {
    for (const path of ['/api/contacts', `/api/contacts/${context.contactId}`, '/api/leads', '/api/opportunities']) {
      assert.equal((await request(path)).status, 200);
    }
    await delay(250);
  }
  await compose(['stop', 'postgres']);
  try {
    assert.equal((await request('/ready')).status, 503);
    for (let index = 0; index < 4; index++) {
      assert.equal((await request('/api/contacts')).status, 500);
      // Let a newly created 5xx counter be scraped before its next increment.
      await delay(2_200);
    }
  } finally { await compose(['start', 'postgres']); }
  await context.ready();
  assert.equal((await request('/api/auth/me')).status, 200, 'Stored session survives the synthetic outage');

  const dashboard = await (await fetch(`${grafana}/api/dashboards/uid/crm-api`, { headers: { authorization } })).json() as {
    dashboard: { panels: { title: string; targets: { expr: string; refId: string }[] }[] };
  };
  assert.equal(dashboard.dashboard.panels.length, 3);
  for (const panel of dashboard.dashboard.panels) {
    await waitFor(async () => {
      const response = await fetch(`${grafana}/api/ds/query`, { method: 'POST', headers: { authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: String(Date.now() - 300_000), to: String(Date.now()), queries: panel.targets.map((target) => ({
          ...target, datasource: { type: 'prometheus', uid: 'crm-prometheus' }, range: true, instant: false, intervalMs: 1_000, maxDataPoints: 300,
        })) }) });
      assert.equal(response.status, 200);
      const result = await response.json() as { results: Record<string, { frames?: {
        schema: { fields: { type: string }[] }; data: { values: (number | null)[][] };
      }[] }> };
      return Object.values(result.results).some((query) => query.frames?.some((frame) => frame.schema.fields.some((field, index) =>
        field.type === 'number' && frame.data.values[index]?.some((value) => typeof value === 'number' && Number.isFinite(value) && value > 0))));
    }, `Grafana panel did not receive non-zero data: ${panel.title}`);
    console.info(`Grafana panel received numeric data: ${panel.title}`);
  }
  const logs = (await compose(['logs', '--no-color', '--no-log-prefix', 'app'])).output;
  for (const secret of [probe, context.password, context.cookie, context.contactId]) assert.ok(!logs.includes(secret), 'Private values never enter API logs');
  const entries = logs.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.ok(entries.some((entry) => entry.event === 'http_request' && entry.route === '/api/contacts/:id' && entry.request_id));
  assert.ok(entries.every((entry) => !['body', 'password', 'headers', 'cookie', 'session', 'url', 'query', 'email'].some((key) => key in entry)));
  const proxyLogs = (await compose(['logs', '--no-color', '--no-log-prefix', 'proxy'])).output;
  assert.ok(!proxyLogs.includes(probe));
  console.info('Public operational paths return 404; monitoring publishes only loopback ports; JSON logs omit private probes.');
}

export async function verifyBackup(context: Context) {
  const { request, compose, execute, python, deployDirectory, environmentFile, directory } = context;
  const lead = await request('/api/leads', 'POST', { contactId: context.contactId, leadScore: 8, stage: 'Qualification' });
  assert.equal(lead.status, 201);
  const leadId = (lead.body.data as { id: string }).id;
  const opportunity = await request('/api/opportunities', 'POST', { leadId, opportunityName: 'Synthetic restore verification', estimatedValue: '123456.78', closeDate: '2028-02-29' });
  assert.equal(opportunity.status, 201);
  assert.equal((await request(`/api/leads/${leadId}`, 'PATCH', { stage: 'Closed Won' })).status, 200);
  const source = (await request(`/api/contacts/${context.contactId}`)).body.data;
  const archive = join(directory, 'synthetic.dump');
  const command = [join(deployDirectory, 'backup.py')];
  await execute(python, [...command, 'backup', '--env-file', environmentFile, '--output', archive]);
  assert.equal((await readFile(archive)).subarray(0, 5).toString(), 'PGDMP');
  const database = 'crm_restore_verification';
  const restored = await execute(python, [...command, 'restore', '--env-file', environmentFile, '--input', archive, '--database', database, '--confirm-new-database', database]);
  const result = JSON.parse(restored.output) as { status: string; counts: Record<string, number> };
  assert.equal(result.status, 'restore_verified');
  assert.deepEqual(result.counts, { contacts: 1, leads: 1, opportunities: 1, users: 1, sessions: 0 });
  const sql = async (query: string, db = database, allowFailure = false) => compose(['exec', '-T', 'postgres', 'psql', '-U', 'crm_production_test', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', query], undefined, allowFailure);
  const rows = JSON.parse((await sql('SELECT row_to_json(c) FROM "Contact" c')).output) as { id: string; email: string };
  assert.equal(rows.id, context.contactId);
  assert.equal(rows.email, (source as { email: string }).email);
  const sales = JSON.parse((await sql('SELECT row_to_json(s) FROM (SELECT l."contactId", l."leadScore", l.stage, o."estimatedValue"::text AS value, o."closeDate"::text AS date FROM "Lead" l JOIN "Opportunity" o ON o."leadId"=l.id) s')).output) as Record<string, unknown>;
  assert.deepEqual(sales, { contactId: context.contactId, leadScore: 8, stage: 'Closed Won', value: '123456.78', date: '2028-02-29' });
  assert.equal((await sql('SELECT count(*) FROM "session"', 'crm_production_test')).output.trim(), '1', 'A live source session exists and was deliberately excluded');
  assert.equal((await sql('UPDATE "Lead" SET "leadScore"=11', database, true)).code, 1, 'Score constraint is restored');
  assert.equal((await sql('UPDATE "Opportunity" SET "estimatedValue"=-1', database, true)).code, 1, 'Money constraint is restored');
  assert.equal((await sql('UPDATE "Lead" SET "contactId"=gen_random_uuid()', database, true)).code, 1, 'Foreign key is restored');
  for (const target of ['crm_production_test', database]) {
    assert.equal((await execute(python, [...command, 'restore', '--env-file', environmentFile, '--input', archive, '--database', target, '--confirm-new-database', target], undefined, true)).code, 1, 'Source and existing targets cannot be overwritten');
  }
  console.info('Backup restore passed: 1 contact, 1 closed lead, 1 opportunity, 1 user, 0 sessions; exact money/date, migration history and constraints preserved.');
}
