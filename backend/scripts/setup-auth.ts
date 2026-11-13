import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';

async function configureSecret(relativePath: string, preferredSecret?: string) {
  const environmentFile = new URL(relativePath, import.meta.url);
  let content: string;
  try {
    content = await readFile(environmentFile, 'utf8');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    content = await readFile(new URL(`${relativePath}.example`, import.meta.url), 'utf8');
  }

  const secret = parse(content).SESSION_SECRET;
  if (secret && secret.length >= 32 && !secret.startsWith('replace-')) return secret;

  const generated = preferredSecret ?? randomBytes(48).toString('hex');
  const setting = `SESSION_SECRET=${generated}`;
  if (/^SESSION_SECRET=.*$/m.test(content)) {
    content = content.replace(/^SESSION_SECRET=.*$/gm, setting);
  } else {
    content += `\n${setting}\n`;
  }
  await writeFile(environmentFile, content, { mode: 0o600 });
  return generated;
}

const localSecret = await configureSecret('../.env');
await configureSecret('../../.env', localSecret);
console.info('Local session secrets configured in backend/.env and root .env; existing valid secrets preserved.');
