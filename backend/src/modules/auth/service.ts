import type { PrismaClient } from '../../generated/prisma/client.js';
import { ApiError } from '../../middleware/errors.js';
import { dummyPasswordHash, verifyPassword } from './password.js';

export async function authenticate(database: PrismaClient, username: string, password: string) {
  const user = await database.user.findUnique({ where: { username } });
  const valid = await verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);
  if (!user || !valid) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
  }
  return { id: user.id, username: user.username };
}
