export interface Target {
  id: string;
  name: string;
  summary: string;
  contract: string;
  actions: string[];
  expectedAnomaly: boolean | null;
}
export interface Settings {
  accessDepth: number;
  suffixDepth: number;
  verifyDepth: number;
  queryLimit: number;
  findingLimit: number;
}
export type RunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export interface RunSummary {
  id: string;
  targetId: string;
  status: RunStatus;
  createdAt: string;
  completedAt: string | null;
  stateCount: number;
  queries: number;
  casesChecked: number;
  findingCount: number;
}
export interface Machine {
  initialState: number;
  states: { id: number; accessSequence: string[] }[];
  transitions: { from: number; action: string; output: string; to: number }[];
}
export interface Finding {
  actions: string[];
  predicted: string[];
  observed: string[];
  firstMismatch: number;
}
export interface Report {
  target: Target;
  settings: Settings;
  machine: Machine;
  findings: Finding[];
  checkedTraces: number;
  uniqueQueries: number;
  cacheHits: number;
  durationMs: number;
  stoppedEarly: boolean;
  confidenceNote: string;
}
export interface RunDetail extends RunSummary {
  settings: Settings;
  report: Report | null;
  startedAt: string | null;
  error: string | null;
}
