import express from 'express';
import type session from 'express-session';
import type { AuthConfig } from './config.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { errorHandler } from './middleware/errors.js';
import { verifyOrigin } from './middleware/origin.js';
import { requireAuthentication } from './modules/auth/middleware.js';
import { authRouter } from './modules/auth/router.js';
import { sessionMiddleware } from './modules/auth/session.js';
import { contactsRouter } from './modules/contacts/router.js';
import { leadsRouter } from './modules/leads/router.js';
import { opportunitiesRouter } from './modules/opportunities/router.js';

type AppDependencies = {
  checkDatabase?: () => Promise<void>;
  api?: { database: PrismaClient; config: AuthConfig; store: session.Store };
};

// Importing the app never starts a listener or loads local environment files.
export function createApp({ checkDatabase, api }: AppDependencies = {}) {
  const app = express();
  app.disable('x-powered-by');

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

  if (api) {
    app.set('trust proxy', api.config.TRUST_PROXY_HOPS);
    const router = express.Router();
    router.use((_request, response, next) => {
      response.set('Cache-Control', 'no-store');
      next();
    });
    router.use(verifyOrigin(api.config.APP_ORIGIN));
    router.use(sessionMiddleware(api.config, api.store));
    router.use('/auth', express.json({ limit: '100kb' }), authRouter(api.database, api.config));
    router.use(requireAuthentication(api.database));
    router.use(express.json({ limit: '100kb' }));
    router.use('/contacts', contactsRouter(api.database));
    router.use('/leads', leadsRouter(api.database));
    router.use('/opportunities', opportunitiesRouter(api.database));
    app.use('/api', router);
  }

  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use(errorHandler);

  return app;
}
