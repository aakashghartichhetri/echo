import type { RunDetail, RunSummary, Settings, Target } from './types';

async function json<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload: { error?: string } = await response.json();
      message = payload.error ?? message;
    } catch { /* Non-JSON responses are still shown with their status. */ }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export const api = {
  targets: () => json<Target[]>('/targets'),
  runs: () => json<RunSummary[]>('/runs?limit=50'),
  run: (id: string) => json<RunDetail>(`/runs/${encodeURIComponent(id)}`),
  start: (targetId: string, settings: Settings) => json<{ id: string; status: string }>('/runs', {
    method: 'POST', body: JSON.stringify({ targetId, settings }),
  }),
  cancel: (id: string) => json<{ status: string }>(`/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  delete: async (id: string) => {
    const response = await fetch(`/api/v1/runs/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Unable to delete run (HTTP ${response.status})`);
  },
  trace: (targetId: string, actions: string[]) => json<{ outputs: string[] }>('/sandbox/execute', {
    method: 'POST', body: JSON.stringify({ targetId, actions }),
  }),
};
