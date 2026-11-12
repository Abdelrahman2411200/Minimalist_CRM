import express from 'express';

// Importing the app never starts a listener or loads local environment files.
export function createApp({ checkDatabase }: { checkDatabase?: () => Promise<void> } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.get('/ready', async (_request, response) => {
    response.set('Cache-Control', 'no-store');
    try {
      if (!checkDatabase) {
        throw new Error('Database not configured');
      }
      await checkDatabase();
      response.status(200).json({ status: 'ready' });
    } catch {
      response.status(503).json({ status: 'unavailable' });
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  return app;
}
