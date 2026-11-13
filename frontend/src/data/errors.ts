import { ZodError } from 'zod';

export type FieldIssue = { path: string; message: string };

export class CrmError extends Error {
  constructor(public status: number, public code: string, message: string, public details: FieldIssue[] = []) {
    super(message);
  }
}

export function validationError(error: ZodError) {
  return new CrmError(400, 'VALIDATION_ERROR', 'Check the form fields.', error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.code === 'unrecognized_keys' ? 'Unexpected fields' : issue.message,
  })));
}
