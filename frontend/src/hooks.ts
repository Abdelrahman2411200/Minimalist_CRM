import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { z } from 'zod';
import { validationError, type CrmError } from './data/errors';

export function useSave<S extends z.ZodType, R extends { id: string }>(
  schema: S,
  save: (input: z.output<S>) => Promise<R>,
  destination: (record: R) => string,
  notice: string,
) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [localError, setLocalError] = useState<CrmError | null>(null);
  const mutation = useMutation({
    mutationFn: save,
    meta: { requiresAuth: true },
    onSuccess: async (record) => {
      await client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      navigate(destination(record), { state: { notice } });
    },
  });
  const error = localError ?? mutation.error;
  const fieldErrors = error && 'details' in error
    ? Object.fromEntries((error as CrmError).details.map((issue) => [issue.path, issue.message]))
    : {};
  return {
    error, fieldErrors, pending: mutation.isPending,
    submit(input: unknown) {
      mutation.reset();
      const result = schema.safeParse(input);
      if (!result.success) {
        setLocalError(validationError(result.error));
        return;
      }
      setLocalError(null);
      mutation.mutate(result.data);
    },
  };
}

export function changedFields<T extends object>(original: T, values: Partial<T>): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => original[key as keyof T] !== value)) as Partial<T>;
}
