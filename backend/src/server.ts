import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './database.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const app = createApp({
  checkDatabase: async () => {
    await database.$queryRaw`SELECT 1`;
  },
});
const server = app.listen(config.PORT, config.HOST, () => {
  console.info(`CRM API listening on http://${config.HOST}:${config.PORT}`);
});

server.on('error', async (error: NodeJS.ErrnoException) => {
  console.error(`API listener failed: ${error.code ?? 'UNKNOWN'}`);
  process.exitCode = 1;
  await database.$disconnect();
});

function shutdown() {
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  server.close(async (error) => {
    await database.$disconnect();
    clearTimeout(deadline);
    process.exitCode = error ? 1 : 0;
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
