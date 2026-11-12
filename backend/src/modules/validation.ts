import { z } from 'zod';

export const idSchema = z.uuid();
export const requiredText = z.string().trim().min(1).max(200);

export function patchSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');
}

export const moneySchema = z.string().regex(
  /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/,
  'Use a non-negative decimal string with up to twelve integral digits and two fractional digits',
);

export const dateSchema = z.string().refine((value) => {
  if (!/^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Use a valid calendar date in YYYY-MM-DD format');
