import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';

const environmentFile = new URL('../.env', import.meta.url);
let content: string;
try {
  content = await readFile(environmentFile, 'utf8');
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  content = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
}

const secret = parse(content).SESSION_SECRET;
if (secret && secret.length >= 32 && !secret.startsWith('replace-')) {
  console.info('Local session secret is already configured.');
} else {
  const setting = `SESSION_SECRET=${randomBytes(48).toString('hex')}`;
  if (/^SESSION_SECRET=.*$/m.test(content)) {
    content = content.replace(/^SESSION_SECRET=.*$/gm, setting);
  } else {
    content += `\n${setting}\n`;
  }
  await writeFile(environmentFile, content, { mode: 0o600 });
  console.info('Local session secret configured in backend/.env.');
}
