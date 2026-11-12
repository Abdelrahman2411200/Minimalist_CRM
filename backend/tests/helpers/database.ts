import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';

const execute = promisify(execFile);
export const backendDirectory = fileURLToPath(new URL('../../', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

export async function runPrisma(args: string[], databaseUrl: string, nodeEnvironment = 'test') {
  const result = await execute(process.execPath, [prismaCli, ...args], {
    cwd: backendDirectory,
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: nodeEnvironment },
    timeout: 60_000,
  });
  return result.stdout;
}

export async function createTestDatabase() {
  assert.ok(process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL to a local/test PostgreSQL server with CREATEDB rights');
  const targetUrl = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(targetUrl.protocol));
  const admin = new Client({ connectionString: targetUrl.toString(), connectionTimeoutMillis: 2_000 });
  const name = `crm_verify_${randomBytes(8).toString('hex')}`;
  targetUrl.pathname = `/${name}`;
  const url = targetUrl.toString();
  const connection = new Client({ connectionString: url, connectionTimeoutMillis: 2_000 });
  let created = false;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await connection.connect();
  } catch (error) {
    await connection.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
    throw error;
  }
  return {
    url,
    connection,
    async close() {
      await connection.end();
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
