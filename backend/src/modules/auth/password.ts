import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const cost = { N: 65_536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 };

function deriveKey(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, Buffer.from(salt, 'hex'), 64, cost, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

// A nonexistent username still incurs the same scrypt work as a known account.
export const dummyPasswordHash = `scrypt$65536$8$2$${'0'.repeat(32)}$${'0'.repeat(128)}`;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt);
  return `scrypt$65536$8$2$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const match = /^scrypt\$65536\$8\$2\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(passwordHash);
  if (!match) return false;
  const key = await deriveKey(password, match[1]!);
  return timingSafeEqual(key, Buffer.from(match[2]!, 'hex'));
}
