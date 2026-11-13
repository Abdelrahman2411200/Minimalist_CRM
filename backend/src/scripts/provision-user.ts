import 'dotenv/config';
import { input as promptInput, password as promptPassword } from '@inquirer/prompts';
import { parseArgs } from 'node:util';
import { z, ZodError } from 'zod';
import { loadConfig } from '../config.js';
import { createDatabase } from '../database.js';
import { Prisma } from '../generated/prisma/client.js';
import { hashPassword } from '../modules/auth/password.js';
import { newPasswordSchema, usernameSchema } from '../modules/auth/schema.js';

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
  const enteredUsername = values['password-stdin']
    ? values.username
    : values.username ?? await promptInput({
      message: 'Staff username',
      validate: (value) => usernameSchema.safeParse(value).success || 'Use 3-64 letters, digits, dots, underscores or hyphens, starting with a letter or digit.',
    });
  const { username } = z.object({ username: usernameSchema }).parse({ username: enteredUsername });
  const enteredPassword = values['password-stdin']
    ? await readPasswordFromStdin()
    : await promptPassword({ message: 'Staff password (12–128 characters)', mask: false });
  const { password } = z.object({ password: newPasswordSchema }).parse({ password: enteredPassword });
  const config = loadConfig();
  database = createDatabase(config.DATABASE_URL);
  await database.user.create({ data: { username, passwordHash: await hashPassword(password) } });
  console.info('Staff account created.');
} catch (error) {
  if (error instanceof ZodError) {
    if (error.issues.some((issue) => issue.path[0] === 'username')) {
      console.error('Invalid username. Choose 3-64 letters, digits, dots, underscores or hyphens, starting with a letter or digit. Run without --username to enter it interactively.');
    } else {
      console.error('Invalid password. Use 12-128 characters without line breaks or null characters.');
    }
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    console.error('That username is already provisioned.');
  } else {
    console.error('Staff provisioning failed. Check database configuration and migrations, then rerun the command to enter credentials.');
  }
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
}
