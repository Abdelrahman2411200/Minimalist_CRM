import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { Client } from 'pg';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/database.js';
import { syntheticContacts, syntheticLeads, syntheticOpportunities } from '../prisma/fixtures.js';

const execute = promisify(execFile);
const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

async function runPrisma(args: string[], databaseUrl: string, nodeEnvironment = 'test') {
  const result = await execute(process.execPath, [prismaCli, ...args], {
    cwd: backendDirectory,
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: nodeEnvironment },
    timeout: 60_000,
  });
  return result.stdout;
}

async function assertReadiness(database: ReturnType<typeof createDatabase>, expectedStatus: number) {
  const app = createApp({
    checkDatabase: async () => {
      await database.$queryRaw`SELECT 1`;
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
    assert.equal(response.status, expectedStatus);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      status: expectedStatus === 200 ? 'ready' : 'unavailable',
    });
    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('Phase 2 PostgreSQL schema, fixtures, and readiness', { timeout: 180_000 }, async (suite) => {
  assert.ok(process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL to a local/test PostgreSQL server with CREATEDB rights');
  const adminUrl = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(adminUrl.protocol));

  // Only this randomly named database is changed and dropped. Existing databases are retained.
  const databaseName = `crm_verify_${randomBytes(8).toString('hex')}`;
  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${databaseName}`;
  const databaseUrl = targetUrl.toString();
  const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 2_000 });
  let created = false;
  let sql: Client | undefined;
  let database: ReturnType<typeof createDatabase> | undefined;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    sql = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    await sql.connect();
    const connection = sql;

    await suite.test('migrations apply to an empty database and reapply without changes', async () => {
      const empty = await connection.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'");
      assert.equal(empty.rows[0].count, 0);
      await runPrisma(['migrate', 'deploy'], databaseUrl);
      const repeated = await runPrisma(['migrate', 'deploy'], databaseUrl);
      assert.match(repeated, /No pending migrations/);
      const migrations = await connection.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL');
      assert.equal(migrations.rows[0].count, 1);
    });

    database = createDatabase(databaseUrl);
    const client = database;

    await suite.test('synthetic seed is repeatable and preserves other records', async () => {
      await runPrisma(['db', 'seed'], databaseUrl);
      assert.equal(await client.contact.count(), 3);
      assert.equal(await client.lead.count(), 2);
      assert.equal(await client.opportunity.count(), 3);
      assert.equal(await client.user.count(), 0);
      const untouched = await client.contact.create({ data: {
        firstName: 'Untouched', lastName: 'Fixture', email: 'untouched@example.test',
        company: 'Synthetic Extra Company', leadSource: 'Test', notes: 'Keep this note',
      } });
      await runPrisma(['db', 'seed'], databaseUrl);
      assert.equal(await client.contact.count(), 4);
      assert.equal(await client.lead.count(), 2);
      assert.equal(await client.opportunity.count(), 3);
      assert.equal((await client.contact.findUniqueOrThrow({ where: { id: untouched.id } })).notes, 'Keep this note');
      assert.equal((await client.contact.findUniqueOrThrow({ where: { id: syntheticContacts[2]!.id }, include: { lead: true } })).lead, null);
      const linked = await client.lead.findUniqueOrThrow({ where: { id: syntheticLeads[1]!.id }, include: { opportunities: true } });
      assert.equal(linked.opportunities.length, 2);
    });

    await suite.test('seed rejects production mode', async () => {
      await assert.rejects(runPrisma(['db', 'seed'], databaseUrl, 'production'));
      assert.equal(await client.contact.count(), 4);
    });

    const contactId = randomUUID();
    let leadId: string;
    await suite.test('database generates UUIDs and defaults a new lead to Prospecting', async () => {
      const generated = await connection.query(
        'INSERT INTO "Contact" ("firstName", "lastName", "email", "company", "leadSource") VALUES ($1, $2, $3, $4, $5) RETURNING "id"',
        ['Auto', 'Fixture', 'auto@example.test', 'Synthetic Auto Company', 'Test'],
      );
      assert.match(generated.rows[0].id, /^[0-9a-f-]{36}$/);
      await connection.query('INSERT INTO "Contact" ("id", "firstName", "lastName", "email", "company", "leadSource") VALUES ($1, $2, $3, $4, $5, $6)',
        [contactId, 'Score', 'Fixture', 'score@example.test', 'Synthetic Score Company', 'Test']);
      const lead = await connection.query('INSERT INTO "Lead" ("contactId", "leadScore") VALUES ($1, 1) RETURNING "id", "stage"', [contactId]);
      leadId = lead.rows[0].id;
      assert.match(leadId, /^[0-9a-f-]{36}$/);
      assert.equal(lead.rows[0].stage, 'Prospecting');
    });

    await suite.test('score bounds reject invalid INSERT and UPDATE operations', async () => {
      for (const score of [0, 11]) {
        await assert.rejects(connection.query('UPDATE "Lead" SET "leadScore" = $1 WHERE "id" = $2', [score, leadId]),
          { code: '23514', constraint: 'Lead_leadScore_range' });
        await assert.rejects(connection.query('INSERT INTO "Lead" ("contactId", "leadScore") VALUES ($1, $2)', [syntheticContacts[2]!.id, score]),
          { code: '23514', constraint: 'Lead_leadScore_range' });
      }
      await assert.rejects(connection.query('UPDATE "Lead" SET "leadScore" = $1 WHERE "id" = $2', ['1.5', leadId]), { code: '22P02' });
      await connection.query('UPDATE "Lead" SET "leadScore" = 10 WHERE "id" = $1', [leadId]);
      assert.equal((await client.lead.findUniqueOrThrow({ where: { id: leadId } })).leadScore, 10);
    });

    await suite.test('lead uniqueness and both foreign keys reject invalid relationships', async () => {
      await assert.rejects(connection.query('INSERT INTO "Lead" ("contactId", "leadScore") VALUES ($1, 5)', [contactId]),
        { code: '23505', constraint: 'Lead_contactId_key' });
      await assert.rejects(connection.query('INSERT INTO "Lead" ("contactId", "leadScore") VALUES ($1, 5)', [randomUUID()]),
        { code: '23503', constraint: 'Lead_contactId_fkey' });
      await assert.rejects(connection.query('UPDATE "Lead" SET "contactId" = $1 WHERE "id" = $2', [randomUUID(), leadId]), { code: '23503' });
      await assert.rejects(connection.query('INSERT INTO "Opportunity" ("leadId", "opportunityName", "estimatedValue", "closeDate") VALUES ($1, $2, $3, $4)',
        [randomUUID(), 'Orphan fixture', '1.00', '2027-01-01']), { code: '23503', constraint: 'Opportunity_leadId_fkey' });
      await assert.rejects(connection.query('UPDATE "Opportunity" SET "leadId" = $1 WHERE "id" = $2', [randomUUID(), syntheticOpportunities[0]!.id]), { code: '23503' });
      await assert.rejects(connection.query('DELETE FROM "Contact" WHERE "id" = $1', [contactId]), { code: '23001', constraint: 'Lead_contactId_fkey' });
      await assert.rejects(connection.query('DELETE FROM "Lead" WHERE "id" = $1', [syntheticLeads[0]!.id]), { code: '23001', constraint: 'Opportunity_leadId_fkey' });
    });

    await suite.test('PostgreSQL accepts exactly the six lead stages', async () => {
      for (const stage of ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost']) {
        await connection.query('UPDATE "Lead" SET "stage" = $1 WHERE "id" = $2', [stage, leadId]);
        const stored = await connection.query('SELECT "stage" FROM "Lead" WHERE "id" = $1', [leadId]);
        assert.equal(stored.rows[0].stage, stage);
      }
      await assert.rejects(connection.query('UPDATE "Lead" SET "stage" = $1 WHERE "id" = $2', ['Unknown', leadId]), { code: '22P02' });
    });

    await suite.test('required contact fields reject NULL and blank text', async () => {
      await assert.rejects(connection.query('UPDATE "Contact" SET "email" = NULL WHERE "id" = $1', [contactId]), { code: '23502' });
      for (const field of ['firstName', 'lastName', 'email', 'company', 'leadSource']) {
        await assert.rejects(connection.query(`UPDATE "Contact" SET "${field}" = '   ' WHERE "id" = $1`, [contactId]),
          { code: '23514', constraint: 'Contact_required_text_nonblank' });
      }
    });

    await suite.test('money is non-negative and numeric(14,2), with exact decimal round trips', async () => {
      const opportunityId = syntheticOpportunities[0]!.id;
      for (const value of ['-0.01', 'NaN']) {
        await assert.rejects(connection.query('UPDATE "Opportunity" SET "estimatedValue" = $1 WHERE "id" = $2', [value, opportunityId]),
          { code: '23514', constraint: 'Opportunity_estimatedValue_nonnegative' });
        await assert.rejects(connection.query('INSERT INTO "Opportunity" ("leadId", "opportunityName", "estimatedValue", "closeDate") VALUES ($1, $2, $3, $4)',
          [leadId, 'Invalid money fixture', value, '2027-01-01']), { code: '23514' });
      }
      await assert.rejects(connection.query('UPDATE "Opportunity" SET "estimatedValue" = $1 WHERE "id" = $2', ['1000000000000.00', opportunityId]), { code: '22003' });
      for (const value of ['0.00', '0.01', '30000.25', '999999999999.99']) {
        const opportunity = await client.opportunity.update({ where: { id: opportunityId }, data: { estimatedValue: value } });
        assert.equal(opportunity.estimatedValue.toFixed(2), value);
      }
    });

    await suite.test('close dates remain date-only through PostgreSQL and Prisma', async () => {
      const opportunityId = syntheticOpportunities[0]!.id;
      await connection.query("SET TIME ZONE 'Pacific/Honolulu'");
      await connection.query('UPDATE "Opportunity" SET "closeDate" = $1 WHERE "id" = $2', ['2028-02-29', opportunityId]);
      const opportunity = await client.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
      assert.equal(opportunity.closeDate.toISOString(), '2028-02-29T00:00:00.000Z');
      const stored = await connection.query('SELECT to_char("closeDate", \'YYYY-MM-DD\') AS date FROM "Opportunity" WHERE "id" = $1', [opportunityId]);
      assert.equal(stored.rows[0].date, '2028-02-29');
      await assert.rejects(connection.query('UPDATE "Opportunity" SET "closeDate" = $1 WHERE "id" = $2', ['2027-02-29', opportunityId]), { code: '22008' });
    });

    await suite.test('user uniqueness and versioned session storage are available', async () => {
      await connection.query('INSERT INTO "User" ("username", "passwordHash") VALUES ($1, $2)', ['synthetic-staff', 'test-hash-only']);
      await assert.rejects(connection.query('INSERT INTO "User" ("username", "passwordHash") VALUES ($1, $2)', ['synthetic-staff', 'test-hash-only']), { code: '23505' });
      await connection.query('INSERT INTO "session" ("sid", "sess", "expire") VALUES ($1, $2::json, CURRENT_TIMESTAMP + INTERVAL \'1 hour\')', ['synthetic-session', JSON.stringify({ userId: 'synthetic' })]);
      assert.deepEqual((await connection.query('SELECT "sess" FROM "session" WHERE "sid" = $1', ['synthetic-session'])).rows[0].sess, { userId: 'synthetic' });
      const index = await connection.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'session' AND indexname = 'IDX_session_expire'");
      assert.equal(index.rowCount, 1);
    });

    await suite.test('readiness succeeds with PostgreSQL and fails safely when the database is unavailable', async () => {
      await assertReadiness(client, 200);
      const unavailableUrl = new URL(databaseUrl);
      unavailableUrl.pathname = `/crm_absent_${randomBytes(8).toString('hex')}`;
      const unavailableDatabase = createDatabase(unavailableUrl.toString());
      try {
        await assertReadiness(unavailableDatabase, 503);
      } finally {
        await unavailableDatabase.$disconnect();
      }
      await assertReadiness(client, 200);
    });

    await suite.test('server configuration requires a PostgreSQL URL', () => {
      assert.throws(() => loadConfig({}), /Invalid server configuration/);
      assert.throws(() => loadConfig({ DATABASE_URL: 'invalid' }), /Invalid server configuration/);
      assert.throws(() => loadConfig({ DATABASE_URL: 'https://example.test' }), /Invalid server configuration/);
      assert.equal(loadConfig({ DATABASE_URL: databaseUrl }).PORT, 3000);
    });
  } finally {
    await database?.$disconnect();
    await sql?.end();
    if (created) {
      await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    }
    await admin.end();
  }
});
