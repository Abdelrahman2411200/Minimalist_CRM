import type { RequestHandler } from 'express';
import { z } from 'zod';

const emptyQuerySchema = z.strictObject({});

export const noQueryParameters: RequestHandler = (request, _response, next) => {
  emptyQuerySchema.parse(request.query);
  next();
};
