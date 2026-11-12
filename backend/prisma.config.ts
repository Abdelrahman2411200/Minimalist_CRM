import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // Generation and validation work without database credentials.
  // Connection commands require DATABASE_URL, supplied through the environment.
  datasource: { url: process.env.DATABASE_URL },
});
