import 'dotenv/config';
import { password as promptPassword } from '@inquirer/prompts';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/database.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { newPasswordSchema, usernameSchema } from '../src/modules/auth/schema.js';

async function readPasswordFromStdin() {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    value += chunk;
    if (value.length > 1_024) throw new Error('Password input is too long');
  }
  return value.replace(/\r?\n$/, '');
}

let database: ReturnType<typeof createDatabase> | undefined;
try {
  const { values } = parseArgs({ options: {
    username: { type: 'string' },
    'password-stdin': { type: 'boolean', default: false },
  } });
  const username = usernameSchema.parse(values.username);
  const password = newPasswordSchema.parse(values['password-stdin']
    ? await readPasswordFromStdin()
    : await promptPassword({ message: 'Staff password (12–128 characters)', mask: false }));
  const config = loadConfig();
  database = createDatabase(config.DATABASE_URL);
  await database.user.create({ data: { username, passwordHash: await hashPassword(password) } });
  console.info('Staff account created.');
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    console.error('That username is already provisioned.');
  } else {
    console.error('Staff provisioning failed. Supply --username and a 12–128 character password. Check database configuration and migrations.');
  }
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
}
