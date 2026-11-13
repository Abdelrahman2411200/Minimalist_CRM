import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// This verifier owns a fresh Compose project and deletes only that project's test data.
const root = fileURLToPath(new URL('../../', import.meta.url));
const project = `crm-verify-${randomBytes(6).toString('hex')}`;
const directory = await mkdtemp(join(tmpdir(), 'crm-compose-'));
const environmentFile = join(directory, '.env');

async function availablePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

const appPort = await availablePort();
let databasePort = await availablePort();
while (databasePort === appPort) databasePort = await availablePort();
const origin = `http://127.0.0.1:${appPort}`;
const settings = {
  COMPOSE_PROJECT_NAME: project, APP_PORT: String(appPort), POSTGRES_PORT: String(databasePort),
  POSTGRES_DB: 'crm_container_test', POSTGRES_USER: 'crm_container_test',
  POSTGRES_PASSWORD: `${randomBytes(24).toString('hex')}@:/?#%`,
  SESSION_SECRET: randomBytes(48).toString('hex'), CRM_ORIGIN: origin,
  CRM_NODE_ENV: 'development', TRUST_PROXY_HOPS: '0',
};
await writeFile(environmentFile, Object.entries(settings).map(([key, value]) => `${key}='${value}'`).join('\n'), { mode: 0o600 });
const environment = { ...process.env, ...settings };

function docker(args: string[], input?: string, timeout = 900_000) {
  return new Promise<string>((resolve, reject) => {
    const child = execFile('docker', args, { cwd: root, env: environment, timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // Do not dump environment, credentials, session material, or full container logs.
        const diagnostics = stderr.split(/\r?\n/).filter((line) => /npm error|ERROR:|failed|unhealthy|error:/i.test(line)).slice(-16).join('\n');
        if (error) reject(new Error(`Docker step failed (${args.slice(0, 2).join(' ')}). ${diagnostics || stderr.slice(-1_500)}`));
        else resolve(stdout);
      });
    child.stdin?.end(input);
  });
}
const compose = (args: string[], input?: string) => docker(['compose', '--env-file', environmentFile, '-p', project, ...args], input);

let cookie = '';
async function request(path: string, method = 'GET', body?: unknown) {
  return fetch(`${origin}${path}`, {
    method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5_000),
  });
}
async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await request('/ready')).status === 200) return; } catch { /* restarting */ }
    await delay(1_000);
  }
  throw new Error('Container readiness did not recover');
}
type Data = { id: string; firstName?: string; lead?: { opportunities: { estimatedValue: string; closeDate: string }[] } };
async function write(path: string, body: unknown, method = 'POST') {
  const response = await request(path, method, body);
  assert.equal(response.status, method === 'POST' ? 201 : 200, path);
  return (await response.json() as { data: Data }).data;
}

try {
  console.info('Starting an isolated Compose project with a fresh named PostgreSQL volume...');
  await compose(['up', '--build', '-d', '--wait', '--wait-timeout', '120', 'app']);
  const volume = JSON.parse(await docker(['volume', 'inspect', `${project}_postgres_data`])) as { Labels: Record<string, string> }[];
  assert.equal(volume[0]?.Labels['com.docker.compose.project'], project);
  assert.match(await compose(['logs', 'migrate']), /successfully applied/);
  await ready();
  console.info('Fresh migrations and readiness passed. Provisioning synthetic staff through the compiled CLI...');
  const password = randomBytes(24).toString('base64url');
  await compose(['exec', '-T', 'app', 'node', 'dist/scripts/provision-user.js', '--username', 'container-staff', '--password-stdin'], `${password}\n`);
  const index = await request('/');
  assert.equal(index.status, 200);
  const html = await index.text();
  const assetPath = /src="([^"]+\/assets\/[^" ]+\.js)"/.exec(html)?.[1] ?? /src="(\/assets\/[^" ]+\.js)"/.exec(html)?.[1];
  assert.ok(assetPath, 'Full frontend references a built JavaScript asset');
  const asset = await request(assetPath);
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /\/api/);
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/api/contacts')).status, 401);
  for (const path of ['/api', '/api/missing', '/api/auth/missing']) {
    const response = await request(path);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type')!, /application\/json/);
  }
  assert.equal((await request('/assets/missing.js')).status, 404);
  const login = await request('/api/auth/login', 'POST', { username: 'container-staff', password });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const contact = await write('/api/contacts', {
    firstName: 'Container', lastName: 'Fixture', email: 'container@example.test',
    company: 'Synthetic Container Company', leadSource: 'Container verification',
  });
  const lead = await write('/api/leads', { contactId: contact.id, leadScore: 8 });
  await write('/api/opportunities', { leadId: lead.id, opportunityName: 'Container fixture', estimatedValue: '123456.78', closeDate: '2028-02-29' });
  await write(`/api/contacts/${contact.id}`, { firstName: 'Persisted' }, 'PATCH');

  async function assertPersisted() {
    assert.equal((await request('/api/auth/me')).status, 200, 'PostgreSQL session survives');
    const response = await request(`/api/contacts/${contact.id}`);
    assert.equal(response.status, 200);
    const data = (await response.json() as { data: Data }).data;
    assert.equal(data.firstName, 'Persisted');
    assert.equal(data.lead?.opportunities[0]?.estimatedValue, '123456.78');
    assert.equal(data.lead?.opportunities[0]?.closeDate, '2028-02-29');
  }
  await assertPersisted();
  console.info('Same-origin frontend, protected API, provisioning and contact-to-opportunity workflow passed. Checking database outage readiness...');
  await compose(['stop', 'postgres']);
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/ready')).status, 503);
  await compose(['start', 'postgres']);
  await ready();
  await assertPersisted();
  console.info('Database outage returned 503 readiness while process health stayed 200. Restarting app and PostgreSQL...');
  await compose(['restart', 'postgres', 'app']);
  await ready();
  await assertPersisted();
  console.info('Records and session survived an ordinary restart. Recreating containers while retaining the volume...');
  await compose(['down']);
  await compose(['up', '-d', '--wait', '--wait-timeout', '120', 'app']);
  await ready();
  await assertPersisted();
  assert.match(await compose(['logs', 'migrate']), /No pending migrations/);
  const files = await compose(['exec', '-T', 'app', 'node', '--input-type=module', '-e',
    'import {existsSync} from "node:fs"; for (const path of ["/app/.env","/app/backend/.env","/app/frontend/.env","/app/node_modules/typescript","/app/node_modules/tsx","/app/node_modules/prisma","/app/node_modules/vite","/app/node_modules/@playwright"]) { if (existsSync(path)) process.exit(1); } if (process.getuid() === 0) process.exit(1); console.log("Runtime is non-root and excludes environment files and build/test/migration tools.");']);
  console.info(files.trim());
  console.info('Compose verification passed: fresh setup, readiness, staff sign-in, JSON 404s, exact money/date values, restart and container-recreation persistence.');
} finally {
  // Explicit project scope ensures the user's normal postgres_data volume is untouched.
  try { await compose(['down', '--volumes', '--remove-orphans']); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
