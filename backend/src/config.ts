import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  FRONTEND_DIRECTORY: z.string().trim().min(1).optional(),
  DATABASE_URL: z.string().url().refine(
    (value) => /^postgres(?:ql)?:\/\//.test(value),
    'Expected a PostgreSQL connection URL',
  ),
});

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  let databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl && environment.POSTGRES_HOST) {
    // Containers receive separate credentials so URL-reserved characters round-trip safely.
    const fields = ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'] as const;
    const missing = fields.filter((field) => !environment[field]);
    if (missing.length) throw new Error(`Invalid server configuration: ${missing.join(', ')} required`);
    const url = new URL('postgresql://postgres:5432');
    url.hostname = environment.POSTGRES_HOST;
    url.username = encodeURIComponent(environment.POSTGRES_USER!);
    url.password = encodeURIComponent(environment.POSTGRES_PASSWORD!);
    url.pathname = `/${encodeURIComponent(environment.POSTGRES_DB!)}`;
    databaseUrl = url.toString();
  }
  const result = environmentSchema.safeParse({ ...environment, DATABASE_URL: databaseUrl });

  if (!result.success) {
    // Report field names and validation messages without echoing environment values.
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid server configuration: ${details}`);
  }

  return result.data;
}

function isOrigin(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}

const authEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SESSION_SECRET: z.string().min(32).refine((value) => !value.startsWith('replace-'), 'Generate a random session secret'),
  APP_ORIGIN: z.string().refine(isOrigin, 'Expected an HTTP(S) origin without a path').default('http://127.0.0.1:5173'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
}).superRefine((config, context) => {
  if (config.NODE_ENV === 'production' && !config.APP_ORIGIN.startsWith('https://')) {
    context.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'Production requires an HTTPS origin' });
  }
});

export function loadAuthConfig(environment: NodeJS.ProcessEnv = process.env) {
  const result = authEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid authentication configuration (${fields.join(', ')}). For local setup run npm run auth:setup --workspace backend.`);
  }
  return result.data;
}

export type AuthConfig = ReturnType<typeof loadAuthConfig>;
