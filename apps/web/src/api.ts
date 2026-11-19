import type { Comparison, RunDetail, RunSummary, Settings, Target } from './types';

let csrf = '';
export function setCsrfToken(value: string): void { csrf = value; }

async function json<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options?.body ? { 'content-type': 'application/json' } : {}),
      ...(options?.method && !['GET', 'HEAD'].includes(options.method.toUpperCase()) && csrf ? { 'x-csrf-token': csrf } : {}),
      ...options?.headers,
    },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload: { error?: string } = await response.json();
      message = payload.error ?? message;
    } catch { /* Non-JSON responses are still shown with their status. */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface AccountUser { id: string; login: string; displayName: string; avatarUrl: string | null; }
export const api = {
  me: () => json<{ user: AccountUser; csrfToken: string }>('/auth/me'),
  usage: () => json<{ usedToday: number; dailyLimit: number }>('/account/usage'),
  logout: () => json<void>('/auth/logout', { method: 'POST' }),
  deleteAccount: () => json<void>('/account', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }) }),
  targets: () => json<Target[]>('/targets'),
  runs: () => json<RunSummary[]>('/runs?limit=50'),
  run: (id: string) => json<RunDetail>(`/runs/${encodeURIComponent(id)}`),
  ready: () => json<{ status: string }>('/health/ready'),
  compare: (candidateId: string, baselineId: string) => json<Comparison>(`/runs/${encodeURIComponent(candidateId)}/compare/${encodeURIComponent(baselineId)}`),
  start: (targetId: string, settings: Settings) => json<{ id: string; status: string }>('/runs', {
    method: 'POST', body: JSON.stringify({ targetId, settings }),
  }),
  cancel: (id: string) => json<{ status: string }>(`/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  delete: (id: string) => json<void>(`/runs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  trace: (targetId: string, actions: string[], signal?: AbortSignal) => json<{ outputs: string[] }>('/sandbox/execute', {
    method: 'POST', body: JSON.stringify({ targetId, actions }), signal,
  }),
};
