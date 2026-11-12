import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/database.js';
import { syntheticContacts, syntheticLeads, syntheticOpportunities } from './fixtures.js';

const config = loadConfig();
if (config.NODE_ENV === 'production') {
  throw new Error('Synthetic seeding is available in development and test environments');
}

const database = createDatabase(config.DATABASE_URL);
try {
  await database.$transaction(async (transaction) => {
    for (const contact of syntheticContacts) {
      await transaction.contact.upsert({
        where: { id: contact.id },
        create: contact,
        update: contact,
      });
    }
    for (const lead of syntheticLeads) {
      await transaction.lead.upsert({
        where: { id: lead.id },
        create: lead,
        update: lead,
      });
    }
    for (const opportunity of syntheticOpportunities) {
      await transaction.opportunity.upsert({
        where: { id: opportunity.id },
        create: opportunity,
        update: opportunity,
      });
    }
  });
  console.info('Synthetic fixtures loaded: 3 contacts, 2 leads, 3 opportunities.');
} catch {
  console.error('Synthetic seed failed. Check database connectivity and migration status.');
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}
