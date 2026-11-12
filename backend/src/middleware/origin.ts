import type { RequestHandler } from 'express';
import { ApiError } from './errors.js';

export function verifyOrigin(allowedOrigin: string): RequestHandler {
  return (request, _response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      next();
      return;
    }
    if (request.get('origin') !== allowedOrigin) {
      next(new ApiError(403, 'ORIGIN_REJECTED', 'The request origin is not allowed'));
      return;
    }
    next();
  };
}
