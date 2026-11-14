import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const deployDirectory = join(root, 'deploy');
const project = `crm-production-verify-${randomBytes(5).toString('hex')}`;
const directory = await mkdtemp(join(tmpdir(), 'crm-production-'));
assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
const environmentFile = join(directory, '.env');
const python = process.env.CRM_DEPLOY_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

async function execute(command: string, args: string[], input?: string, allowFailure = false, environment = process.env) {
  return new Promise<{ output: string; code: number }>((done, reject) => {
    const child = execFile(command, args, { cwd: root, env: environment, timeout: 900_000, maxBuffer: 6 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && !allowFailure) reject(new Error(`Production verification command failed: ${command}. ${stdout.slice(-800)} ${stderr.slice(-2_000)}`));
        else done({ output: stdout, code: error ? 1 : 0 });
      });
    child.stdin?.end(input);
  });
}
const docker = (args: string[], input?: string, allowFailure = false) => execute('docker', args, input, allowFailure);
const composeArgs = ['compose', '--profile', 'tools', '--env-file', environmentFile, '-p', project, '-f', join(deployDirectory, 'compose.yaml')];
const compose = (args: string[], input?: string, allowFailure = false) => docker([...composeArgs, ...args], input, allowFailure);

async function port() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  return address.port;
}
const httpsPort = await port();
let httpPort = await port();
while (httpPort === httpsPort) httpPort = await port();
const origin = `https://localhost:${httpsPort}`;
const revision = (await execute('git', ['rev-parse', 'HEAD'])).output.trim();
const image = process.env.CRM_TEST_IMAGE || `${project}-app:sha-${revision}`;
const migrationImage = process.env.CRM_TEST_MIGRATION_IMAGE || `${project}-migrate:sha-${revision}`;
const caFile = join(directory, 'root.crt');
const caddyFile = join(directory, 'Caddyfile');
const username = 'production-test-staff';
const password = randomBytes(24).toString('base64url');
const settings = {
  COMPOSE_PROJECT_NAME: project, CRM_HOST: 'localhost', CRM_ORIGIN: origin, ACME_EMAIL: 'synthetic@example.test',
  CRM_IMAGE: image, CRM_MIGRATION_IMAGE: migrationImage, CADDYFILE_PATH: caddyFile.replaceAll('\\', '/'),
  POSTGRES_DB: 'crm_production_test', POSTGRES_USER: 'crm_production_test',
  POSTGRES_PASSWORD: `${randomBytes(24).toString('hex')}@:/?#%$`, SESSION_SECRET: randomBytes(48).toString('hex'),
  PROXY_BIND: '127.0.0.1', HTTP_PORT: String(httpPort), HTTPS_PORT: String(httpsPort),
};
await writeFile(environmentFile, Object.entries(settings).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n', { mode: 0o600 });
const referenceCaddyfile = await readFile(join(deployDirectory, 'Caddyfile'), 'utf8');
assert.ok(referenceCaddyfile.includes('{$CRM_HOST} {'));
await writeFile(caddyFile, referenceCaddyfile.replace('{$CRM_HOST} {', '{$CRM_HOST} {\n tls internal'));
const controller = async (args: string[], allowFailure = false, timeout = 45) => execute(python,
  [join(deployDirectory, 'deploy.py'), ...args, '--env-file', environmentFile, '--ca-file', caFile, '--timeout', String(timeout), '--no-pull'], undefined, allowFailure);
let certificate: Buffer;
let cookie = '';
async function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }>((done, reject) => {
    const req = https.request(`${origin}${path}`, {
      method, ca: certificate, rejectUnauthorized: true, headers: { Origin: origin, Cookie: cookie,
        'Content-Type': 'application/json', 'X-Forwarded-Proto': 'http', ...headers }, timeout: 5_000,
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { data += chunk; });
      response.on('end', () => {
        try { done({ status: response.statusCode!, headers: response.headers, body: data ? JSON.parse(data) as Record<string, unknown> : {} }); }
        catch { reject(new Error('Expected an API JSON response')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('HTTPS request timed out')));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await request('/ready')).status === 200) return; } catch { /* restarting */ }
    await delay(1_000);
  }
  throw new Error('Production readiness did not recover');
}
const state = async () => JSON.parse(await readFile(join(directory, '.deployment-state.json'), 'utf8')) as {
  current: { revision: string; schema_fingerprint: string }; pending?: { phase: string };
};

try {
  console.info('Verifying the production deployment controller with isolated volumes and trusted local HTTPS...');
  if (!process.env.CRM_TEST_IMAGE) {
    await docker(['build', '--target', 'runtime', '--build-arg', `VCS_REF=${revision}`, '--build-arg', 'SOURCE_URL=https://github.com/example/synthetic', '-t', image, '.']);
    await docker(['build', '--target', 'migrate', '--build-arg', `VCS_REF=${revision}`, '--build-arg', 'SOURCE_URL=https://github.com/example/synthetic', '-t', migrationImage, '.']);
  }
  for (const target of [image, migrationImage]) {
    const data = JSON.parse((await docker(['image', 'inspect', target])).output)[0] as { Config: { Labels: Record<string, string> } };
    assert.equal(data.Config.Labels['org.opencontainers.image.revision'], revision, 'Supply the original full/migration image pair built from the current source commit');
  }
  await compose(['pull', 'postgres', 'proxy']);
  // Bootstrap only a local internal CA, then trust it explicitly. Production uses public ACME TLS.
  await compose(['up', '-d', '--no-deps', 'proxy']);
  let copied = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await compose(['cp', 'proxy:/data/caddy/pki/authorities/local/root.crt', caFile], undefined, true);
    if (result.code === 0) { copied = true; break; }
    await delay(1_000);
  }
  assert.ok(copied, 'Caddy generated a test CA');
  certificate = await readFile(caFile);
  assert.equal((await controller(['deploy'])).code, 0);
  await ready();
  const redirect = await new Promise<http.IncomingMessage>((done, reject) => {
    const req = http.get(`http://127.0.0.1:${httpPort}/ready`, { headers: { Host: 'localhost' } }, done);
    req.on('error', reject);
  });
  redirect.resume();
  assert.equal(redirect.statusCode, 308);
  assert.ok(redirect.headers.location?.startsWith('https://localhost/'));
  assert.equal((await state()).current.revision, revision);
  await compose(['exec', '-T', 'app', 'node', 'dist/scripts/provision-user.js', '--username', username, '--password-stdin'], `${password}\n`);
  const smoke = await execute(python, [join(deployDirectory, 'smoke.py'), '--origin', origin, '--ca-file', caFile, '--allow-synthetic-write'],
    undefined, false, { ...process.env, CRM_SMOKE_USERNAME: username, CRM_SMOKE_PASSWORD: password });
  const verified = JSON.parse(smoke.output) as { status: string; synthetic_contact_id: string };
  assert.equal(verified.status, 'verified');
  const login = await request('/api/auth/login', 'POST', { username, password });
  assert.equal(login.status, 200);
  const setCookie = login.headers['set-cookie']?.[0];
  assert.ok(setCookie && /; Secure/i.test(setCookie) && /; HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie));
  cookie = setCookie.split(';')[0]!;
  assert.equal((await request('/api/auth/login', 'POST', {}, { Origin: 'https://untrusted.example.test' })).status, 403);
  const persisted = async () => {
    assert.equal((await request('/api/auth/me')).status, 200, 'Session survives production restarts');
    assert.equal((await request(`/api/contacts/${verified.synthetic_contact_id}`)).status, 200, 'Synthetic contact survives');
  };
  await persisted();
  for (const service of ['app', 'postgres']) {
    const id = (await compose(['ps', '-q', service])).output.trim();
    const info = JSON.parse((await docker(['inspect', id])).output)[0] as { NetworkSettings: { Ports: Record<string, unknown>; Networks: Record<string, unknown> } };
    assert.ok(Object.values(info.NetworkSettings.Ports).every((value) => value === null), `${service} publishes no host ports`);
    assert.ok(!Object.keys(info.NetworkSettings.Networks).includes(`${project}_edge`));
  }
  for (const name of ['frontend', 'database']) {
    const info = JSON.parse((await docker(['network', 'inspect', `${project}_${name}`])).output)[0] as { Internal: boolean };
    assert.equal(info.Internal, true);
  }
  console.info('HTTPS, Secure/HttpOnly/SameSite session, synthetic contact readback and private networks passed.');
  const before = (await state()).current.schema_fingerprint;
  const appBefore = (await compose(['ps', '-q', 'app'])).output.trim();
  await controller(['deploy']);
  assert.equal((await state()).current.schema_fingerprint, before);
  assert.equal((await compose(['ps', '-q', 'app'])).output.trim(), appBefore, 'Idempotent deploy does not replace an unchanged app');
  await compose(['restart', 'postgres', 'app', 'proxy']);
  await ready();
  await persisted();
  console.info('Repeated migration deployment and app/database/proxy restart preserve schema, data and session.');

  const nextRevision = randomBytes(20).toString('hex');
  const nextApp = `${project}-next-app:sha-${nextRevision}`;
  const nextMigration = `${project}-next-migrate:sha-${nextRevision}`;
  await docker(['build', '-t', nextApp, '-f', '-', '.'], `FROM ${image}\nLABEL org.opencontainers.image.revision="${nextRevision}"\n`);
  const extraSql = 'BEGIN;\nCREATE TABLE "Phase7CompatibilityFixture" ("id" INTEGER PRIMARY KEY);\nCOMMIT;\n';
  const writeMigration = `const fs=require('node:fs');const p='/app/backend/prisma/migrations/20261114000000_compatibility_fixture';fs.mkdirSync(p,{recursive:true});fs.writeFileSync(p+'/migration.sql',${JSON.stringify(extraSql)});`;
  await docker(['build', '-t', nextMigration, '-f', '-', '.'],
    `FROM ${migrationImage}\nUSER root\nRUN node -e '${writeMigration.replaceAll("'", "'\\''")}'\nLABEL org.opencontainers.image.revision="${nextRevision}"\nUSER node\n`);
  await controller(['deploy', '--image', nextApp, '--migration-image', nextMigration]);
  const expanded = (await state()).current.schema_fingerprint;
  assert.notEqual(expanded, before, 'An additive migration changes the actual schema fingerprint');
  await persisted();
  await controller(['deploy']);
  assert.equal((await controller(['rollback'], true)).code, 1);
  assert.equal((await controller(['rollback', '--schema-compatible-with', before], true)).code, 1, 'An old acknowledgement cannot authorize a new schema');
  // The added table is deliberately compatible with the original API. Review is explicit.
  await controller(['rollback', '--schema-compatible-with', expanded]);
  assert.equal((await state()).current.revision, revision, 'Rollback restores the previous successful release, including after an idempotent redeploy');
  assert.equal((await state()).current.schema_fingerprint, expanded, 'Rollback never reverses the applied migration');
  await persisted();
  console.info('Successful upgrade applies an additive migration; explicit schema review permits the previous image while retaining the newer schema.');

  // Derived, explicitly synthetic releases exercise version switching without publishing test images.
  const badRevision = randomBytes(20).toString('hex');
  const badApp = `${project}-bad-app:sha-${badRevision}`;
  const badMigration = `${project}-bad-migrate:sha-${badRevision}`;
  await docker(['build', '-t', badMigration, '-f', '-', '.'], `FROM ${nextMigration}\nLABEL org.opencontainers.image.revision="${badRevision}"\nCMD ["node","-e","process.exit(1)"]\n`);
  await docker(['build', '-t', badApp, '-f', '-', '.'], `FROM ${image}\nLABEL org.opencontainers.image.revision="${badRevision}"\nCMD ["node","-e","process.exit(1)"]\n`);
  const running = (await compose(['ps', '-q', 'app'])).output.trim();
  assert.equal((await controller(['deploy', '--image', badApp, '--migration-image', badMigration], true, 10)).code, 1);
  assert.equal((await compose(['ps', '-q', 'app'])).output.trim(), running, 'Failed migration never switches the running application');
  await persisted();
  // Give the failed candidate a working migration image, so only its app startup fails.
  await docker(['build', '-t', badMigration, '-f', '-', '.'], `FROM ${nextMigration}\nLABEL org.opencontainers.image.revision="${badRevision}"\n`);
  assert.equal((await controller(['deploy', '--image', badApp, '--migration-image', badMigration], true)).code, 1);
  assert.equal((await state()).pending?.phase, 'failed');
  assert.equal((await controller(['rollback'], true)).code, 1, 'Rollback requires explicit schema compatibility review');
  assert.equal((await controller(['rollback', '--schema-compatible-with', 'wrong-fingerprint'], true)).code, 1);
  await controller(['rollback', '--schema-compatible-with', expanded]);
  await ready();
  await persisted();
  assert.equal((await state()).current.revision, revision);
  console.info('Failed migrations preserve the running app; failed startup remains recorded; reviewed same-schema rollback restores HTTPS/data/session without down migrations.');
  console.info('Production lifecycle verification passed.');
} finally {
  try { await compose(['down', '--volumes', '--remove-orphans']); }
  finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
}
