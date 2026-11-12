import { z } from 'zod';
import type { LeadStage } from '../../generated/prisma/enums.js';

export const stageSchema = z.enum([
  'Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost',
]);

const databaseStages: Record<z.infer<typeof stageSchema>, LeadStage> = {
  Prospecting: 'Prospecting',
  Qualification: 'Qualification',
  Proposal: 'Proposal',
  Negotiation: 'Negotiation',
  'Closed Won': 'ClosedWon',
  'Closed Lost': 'ClosedLost',
};

export function toDatabaseStage(stage: z.infer<typeof stageSchema>) {
  return databaseStages[stage];
}

export function toApiStage(stage: LeadStage) {
  if (stage === 'ClosedWon') return 'Closed Won';
  if (stage === 'ClosedLost') return 'Closed Lost';
  return stage;
}
