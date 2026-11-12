import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import type { AuthConfig } from '../../config.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

export const sessionCookieName = 'crm.sid';

export function cookieOptions(config: AuthConfig) {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function createSessionStore(connectionString: string) {
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 2_000, query_timeout: 2_000 });
  pool.on('error', () => console.error('Session database connection failed'));
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool,
    tableName: 'session',
    createTableIfMissing: false,
    pruneSessionInterval: 900,
    errorLog: () => console.error('Session storage operation failed'),
  });

  return {
    store,
    async close() {
      await store.close();
      await pool.end();
    },
  };
}

export function sessionMiddleware(config: AuthConfig, store: session.Store) {
  return session({
    name: sessionCookieName,
    store,
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { ...cookieOptions(config), maxAge: 8 * 60 * 60 * 1_000 },
  });
}
