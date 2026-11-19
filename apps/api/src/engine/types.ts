/** No target implementation is imported into the learning engine. */
export interface TraceOracle {
  trace(actions: string[], signal?: AbortSignal): Promise<string[]>;
}

export interface TargetDescriptor {
  id: string;
  name: string;
  summary: string;
  contract: string;
  actions: string[];
  expectedAnomaly: boolean | null;
}

export interface LearnOptions {
  accessDepth: number;
  suffixDepth: number;
  verifyDepth: number;
  queryLimit: number;
  findingLimit: number;
}

export interface State {
  id: number;
  accessSequence: string[];
}

export interface Transition {
  from: number;
  action: string;
  output: string;
  to: number;
}

export interface Machine {
  initialState: number;
  states: State[];
  transitions: Transition[];
}

export interface Finding {
  actions: string[];
  predicted: string[];
  observed: string[];
  firstMismatch: number;
}

export interface VerificationSample {
  actions: string[];
  outputs: string[];
}

export interface AnalysisReport {
  target: TargetDescriptor;
  settings: LearnOptions;
  machine: Machine;
  findings: Finding[];
  samples: VerificationSample[];
  checkedTraces: number;
  uniqueQueries: number;
  cacheHits: number;
  durationMs: number;
  stoppedEarly: boolean;
  confidenceNote: string;
}

export interface Progress {
  phase: 'learning' | 'verifying';
  queries: number;
  checkedTraces: number;
  states: number;
}
