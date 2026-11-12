import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const server = createApp().listen(config.PORT, config.HOST, () => {
  console.info(`CRM API listening on http://${config.HOST}:${config.PORT}`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`API listener failed: ${error.code ?? 'UNKNOWN'}`);
  process.exitCode = 1;
});

function shutdown() {
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  server.close((error) => {
    clearTimeout(deadline);
    process.exitCode = error ? 1 : 0;
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
