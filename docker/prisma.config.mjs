import { defineConfig } from 'prisma/config';
import { loadConfig } from './dist/config.js';

// Container-only config: no dotenv files, seed runner or development dependencies.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: loadConfig().DATABASE_URL },
});
