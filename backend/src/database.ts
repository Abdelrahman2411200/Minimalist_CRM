import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export function createDatabase(connectionString: string) {
  const adapter = new PrismaPg({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 2_000,
    query_timeout: 2_000,
    statement_timeout: 2_000,
  });

  // Readiness failures are translated into a generic response by the HTTP layer.
  return new PrismaClient({ adapter, log: [] });
}
