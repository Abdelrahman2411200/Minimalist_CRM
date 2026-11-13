import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';

test('same-origin static frontend preserves operational endpoints and JSON 404s', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'crm-static-'));
  await mkdir(join(directory, 'assets'));
  await mkdir(join(directory, 'api'));
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Full CRM test</title>');
  await writeFile(join(directory, 'assets', 'app-test.js'), 'console.log("fixture")');
  // Even an accidentally packaged file under /api must never be served as an API response.
  await writeFile(join(directory, 'api', 'missing'), '<html>not an API response</html>');
  await writeFile(join(directory, '.env'), 'not-public');
  const server = createApp({ frontendDirectory: directory, checkDatabase: async () => {} }).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const index = await fetch(`${origin}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type')!, /text\/html/);
    assert.equal(index.headers.get('cache-control'), 'no-cache');
    assert.match(await index.text(), /Full CRM test/);
    const asset = await fetch(`${origin}/assets/app-test.js`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    for (const path of ['/api', '/api/missing', '/api/auth/unknown', '/assets/missing.js', '/.env', '/missing']) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 404, path);
      assert.match(response.headers.get('content-type')!, /application\/json/);
      assert.equal((await response.json() as { error: { code: string } }).error.code, 'NOT_FOUND');
    }
    assert.equal((await fetch(`${origin}/`, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(`${origin}/health`)).status, 200);
    assert.equal((await fetch(`${origin}/ready`)).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
