import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { CrmError } from './data/errors';
import type { User } from './data/types';

export type SessionState = { user: User | null; expired: boolean };

export function updateSession(client: QueryClient, session: SessionState) {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
  client.getMutationCache().clear();
  client.setQueryData<SessionState>(['session'], session);
}

function expireSession(error: Error) {
  if (error instanceof CrmError && error.status === 401) {
    updateSession(queryClient, { user: null, expired: true });
  }
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false }, mutations: { retry: false } },
  queryCache: new QueryCache({ onError: expireSession }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.requiresAuth) expireSession(error);
    },
  }),
});
