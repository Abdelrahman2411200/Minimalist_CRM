import { z } from 'zod';

export const stageSchema = z.enum([
  'Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost',
]);

const databaseStages = {
  Prospecting: 'Prospecting',
  Qualification: 'Qualification',
  Proposal: 'Proposal',
  Negotiation: 'Negotiation',
  'Closed Won': 'ClosedWon',
  'Closed Lost': 'ClosedLost',
} as const;

export function toDatabaseStage(stage: z.infer<typeof stageSchema>) {
  return databaseStages[stage];
}

export function toApiStage(stage: typeof databaseStages[keyof typeof databaseStages]) {
  if (stage === 'ClosedWon') return 'Closed Won';
  if (stage === 'ClosedLost') return 'Closed Lost';
  return stage;
}
