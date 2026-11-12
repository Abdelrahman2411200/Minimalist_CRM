import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AuthConfig } from '../../config.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { noQueryParameters } from '../../middleware/validation.js';
import { requireAuthentication } from './middleware.js';
import { loginSchema } from './schema.js';
import { authenticate } from './service.js';
import { cookieOptions, sessionCookieName } from './session.js';

export function authRouter(database: PrismaClient, config: AuthConfig) {
  const router = Router();
  router.use(noQueryParameters);
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' } },
  });

  router.post('/login', loginLimiter, async (request, response) => {
    const credentials = loginSchema.parse(request.body);
    const user = await authenticate(database, credentials.username, credentials.password);
    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) => error ? reject(error) : resolve());
    });
    request.session.userId = user.id;
    await new Promise<void>((resolve, reject) => {
      request.session.save((error) => error ? reject(error) : resolve());
    });
    response.json({ data: user });
  });

  router.post('/logout', async (request, response) => {
    await new Promise<void>((resolve, reject) => {
      request.session.destroy((error) => error ? reject(error) : resolve());
    });
    response.clearCookie(sessionCookieName, cookieOptions(config));
    response.status(204).end();
  });

  router.get('/me', requireAuthentication(database), (_request, response) => {
    response.json({ data: response.locals.user });
  });
  return router;
}
