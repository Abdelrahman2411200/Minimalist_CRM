import type { RequestHandler } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { ApiError } from '../../middleware/errors.js';

export function requireAuthentication(database: PrismaClient): RequestHandler {
  return async (request, response, next) => {
    const userId = request.session.userId;
    if (!userId) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to access the CRM');
    }
    const user = await database.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
    if (!user) {
      delete request.session.userId;
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to access the CRM');
    }
    response.locals.user = user;
    next();
  };
}
