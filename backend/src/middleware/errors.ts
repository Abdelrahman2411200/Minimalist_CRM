import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.js';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(new Error('API response failed'));
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({ error: {
      code: 'VALIDATION_ERROR',
      message: 'Check the request fields',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.code === 'unrecognized_keys' ? 'Unexpected fields' : issue.message,
      })),
    } });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const databaseErrors: Record<string, ApiError> = {
      P2002: new ApiError(409, 'CONFLICT', 'This contact already has a lead'),
      P2003: new ApiError(404, 'PARENT_NOT_FOUND', 'The related contact or lead was not found'),
      P2025: new ApiError(404, 'NOT_FOUND', 'The requested record was not found'),
      P1001: new ApiError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable'),
      P1002: new ApiError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable'),
      P1017: new ApiError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable'),
      P2024: new ApiError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable'),
    };
    error = databaseErrors[error.code] ?? error;
  }
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (typeof error === 'object' && error !== null && 'type' in error) {
    if (error.type === 'entity.parse.failed') {
      response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Provide a valid JSON request body' } });
      return;
    }
    if (error.type === 'entity.too.large') {
      response.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'The request body exceeds 100 KB' } });
      return;
    }
  }
  // Exception objects may contain query parameters, request bodies, or session material.
  console.error('API request failed');
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed' } });
};
