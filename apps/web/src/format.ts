export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function compactNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}
export function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
export function shortId(id: string): string { return id.startsWith('demo-') ? 'SAMPLE' : id.slice(0, 8); }
export function isActive(status: string): boolean { return status === 'QUEUED' || status === 'RUNNING'; }
