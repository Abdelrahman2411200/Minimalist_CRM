import 'dotenv/config';
import { access } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { loadAuthConfig, loadConfig } from './config.js';
import { createDatabase } from './database.js';
import { createSessionStore } from './modules/auth/session.js';
import { createMetricsServer, createTelemetry } from './telemetry/http.js';
import { logSystem } from './telemetry/logging.js';

async function main() {
  const config = loadConfig();
  const authConfig = loadAuthConfig();
  if (config.FRONTEND_DIRECTORY) {
    if (!isAbsolute(config.FRONTEND_DIRECTORY)) throw new Error('Invalid frontend directory');
    await access(join(config.FRONTEND_DIRECTORY, 'index.html'));
  }
  const database = createDatabase(config.DATABASE_URL);
  const sessions = createSessionStore(config.DATABASE_URL);
  const telemetry = createTelemetry();
  const app = createApp({
    frontendDirectory: config.FRONTEND_DIRECTORY, telemetry,
    api: { database, config: authConfig, store: sessions.store },
    checkDatabase: async () => { await database.$queryRaw`SELECT 1`; },
  });
  const metrics = createMetricsServer(telemetry.registry);
  let api: Server | undefined;
  let stopping = false;
  async function shutdown(failed = false) {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    const close = (server: Server | undefined) => new Promise<void>((resolve) => {
      if (!server?.listening) resolve();
      else server.close(() => resolve());
    });
    try {
      await Promise.all([close(api), close(metrics)]);
      await Promise.all([database.$disconnect(), sessions.close()]);
      logSystem('shutdown');
    } catch { failed = true; logSystem('shutdown_failed', 'error'); }
    clearTimeout(deadline);
    process.exitCode = failed ? 1 : 0;
  }
  try {
    metrics.listen(config.METRICS_PORT, config.METRICS_HOST);
    await once(metrics, 'listening');
    logSystem('metrics_listening');
    api = app.listen(config.PORT, config.HOST);
    await once(api, 'listening');
    logSystem('api_listening');
  } catch {
    logSystem('listener_failed', 'error');
    await shutdown(true);
    return;
  }
  for (const server of [api, metrics]) server.on('error', () => {
    logSystem('listener_failed', 'error'); void shutdown(true);
  });
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('unhandledRejection', () => { logSystem('unhandled_error', 'error'); void shutdown(true); });
  process.once('uncaughtException', () => { logSystem('unhandled_error', 'error'); void shutdown(true); });
}

main().catch(() => { logSystem('startup_failed', 'error'); process.exitCode = 1; });
