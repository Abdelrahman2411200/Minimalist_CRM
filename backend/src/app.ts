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
  frontendDirectory?: string;
  api?: { database: PrismaClient; config: AuthConfig; store: session.Store };
};

// Importing the app never starts a listener or loads local environment files.
export function createApp({ checkDatabase, api, frontendDirectory }: AppDependencies = {}) {
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
    const authenticated = requireAuthentication(api.database);
    const json = express.json({ limit: '100kb' });
    router.use('/contacts', authenticated, json, contactsRouter(api.database));
    router.use('/leads', authenticated, json, leadsRouter(api.database));
    router.use('/opportunities', authenticated, json, opportunitiesRouter(api.database));
    app.use('/api', router);
  }

  // Never let an unknown API URL fall through to the frontend (or an HTML fallback).
  app.use('/api', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found' } });
  });

  if (frontendDirectory) {
    // Hash navigation requests only / and real asset paths; missing files remain 404s.
    app.use(express.static(frontendDirectory, { dotfiles: 'deny', setHeaders(response, path) {
      response.setHeader('Cache-Control', /[/\\]assets[/\\]/.test(path)
        ? 'public, max-age=31536000, immutable' : 'no-cache');
    } }));
  }

  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.use(errorHandler);

  return app;
}
