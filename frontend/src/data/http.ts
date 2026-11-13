import { CrmError } from './errors';
import type { CrmData } from './types';

async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new CrmError(0, 'NETWORK_ERROR', 'Could not reach the CRM. Check your connection and try again.');
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null) as {
    data: T;
    error?: { code: string; message: string; details?: { path: string; message: string }[] };
  } | null;
  if (!response.ok) {
    throw new CrmError(response.status, payload?.error?.code || 'REQUEST_FAILED',
      payload?.error?.message || 'The request failed. Please try again.', payload?.error?.details);
  }
  if (!payload || !('data' in payload)) throw new CrmError(502, 'INVALID_RESPONSE', 'The CRM returned an unexpected response.');
  return payload.data;
}

function queryString(query: object = {}) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string' && value) parameters.set(key, value);
  }
  const text = parameters.toString();
  return text ? `?${text}` : '';
}

export const crm: CrmData = {
  kind: 'full',
  async me(signal) {
    try { return await request('/auth/me', 'GET', undefined, signal); }
    catch (error) {
      if (error instanceof CrmError && error.status === 401) return null;
      throw error;
    }
  },
  login: (username, password) => request('/auth/login', 'POST', { username, password }),
  logout: () => request('/auth/logout', 'POST'),
  listContacts: (query, signal) => request(`/contacts${queryString(query)}`, 'GET', undefined, signal),
  getContact: (id, signal) => request(`/contacts/${encodeURIComponent(id)}`, 'GET', undefined, signal),
  createContact: (input) => request('/contacts', 'POST', input),
  updateContact: (id, input) => request(`/contacts/${encodeURIComponent(id)}`, 'PATCH', input),
  listLeads: (query, signal) => request(`/leads${queryString(query)}`, 'GET', undefined, signal),
  getLead: (id, signal) => request(`/leads/${encodeURIComponent(id)}`, 'GET', undefined, signal),
  createLead: (input) => request('/leads', 'POST', input),
  updateLead: (id, input) => request(`/leads/${encodeURIComponent(id)}`, 'PATCH', input),
  listOpportunities: (query, signal) => request(`/opportunities${queryString(query)}`, 'GET', undefined, signal),
  getOpportunity: (id, signal) => request(`/opportunities/${encodeURIComponent(id)}`, 'GET', undefined, signal),
  createOpportunity: (input) => request('/opportunities', 'POST', input),
  updateOpportunity: (id, input) => request(`/opportunities/${encodeURIComponent(id)}`, 'PATCH', input),
};
