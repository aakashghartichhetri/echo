import type { AnalysisReport, Finding, LearnOptions, Machine, Progress, TargetDescriptor, TraceOracle } from './types.js';
import { predict, sequencesThroughDepth } from './sequences.js';

export class ExplorationError extends Error {
  constructor(message: string, public readonly code: 'QUERY_LIMIT' | 'NOT_CLOSED' | 'INVALID_ORACLE' | 'ABORTED') {
    super(message);
    this.name = 'ExplorationError';
  }
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExplorationError('Exploration was cancelled', 'ABORTED');
}

/** Cached traces make learning deterministic and keep probe costs bounded. */
export class QuerySession {
  private readonly cache = new Map<string, string[]>();
  private hits = 0;

  constructor(private readonly oracle: TraceOracle, private readonly limit: number, private readonly signal?: AbortSignal) {}

  get queries(): number { return this.cache.size; }
  get cacheHits(): number { return this.hits; }

  async observe(actions: string[]): Promise<string[]> {
    assertActive(this.signal);
    const key = JSON.stringify(actions);
    const cached = this.cache.get(key);
    if (cached) {
      this.hits += 1;
      return [...cached];
    }
    if (this.cache.size >= this.limit) throw new ExplorationError(`Query budget of ${this.limit} exceeded`, 'QUERY_LIMIT');
    const result = await this.oracle.trace(actions, this.signal);
    if (!Array.isArray(result) || result.length !== actions.length || result.some((value) => typeof value !== 'string' || value.length > 100)) {
      throw new ExplorationError('Oracle returned an invalid trace (one string output per action is required)', 'INVALID_ORACLE');
    }
    // Only cache successful queries; failures should never be treated as observations.
    this.cache.set(key, [...result]);
    return [...result];
  }
}

export function validateOptions(actions: readonly string[], options: LearnOptions): void {
  if (actions.length < 2 || actions.length > 5 || new Set(actions).size !== actions.length || actions.some((a) => !/^[a-z][a-z0-9-]{0,30}$/.test(a))) {
    throw new Error('Target alphabet must have 2–5 unique, simple action names');
  }
  const { accessDepth, suffixDepth, verifyDepth, queryLimit, findingLimit } = options;
  if (!Number.isInteger(accessDepth) || accessDepth < 2 || accessDepth > 6 ||
      !Number.isInteger(suffixDepth) || suffixDepth < 1 || suffixDepth > 4 ||
      !Number.isInteger(verifyDepth) || verifyDepth < 1 || verifyDepth > 9 ||
      !Number.isInteger(queryLimit) || queryLimit < 100 || queryLimit > 20000 ||
      !Number.isInteger(findingLimit) || findingLimit < 1 || findingLimit > 5) {
    throw new Error('Invalid exploration limits');
  }
}

/**
 * Approximate Mealy-machine inference using bounded distinguishing suffixes.
 * Histories with equal future-output signatures are merged into a state.
 * A larger suffix depth can reveal distinctions missed by a shorter one.
 */
export async function analyze(
  target: TargetDescriptor,
  oracle: TraceOracle,
  options: LearnOptions,
  signal?: AbortSignal,
  onProgress?: (progress: Progress) => void,
): Promise<AnalysisReport> {
  validateOptions(target.actions, options);
  const started = Date.now();
  const session = new QuerySession(oracle, options.queryLimit, signal);
  const suffixes = [...sequencesThroughDepth(target.actions, options.suffixDepth)];
  const signatures = new Map<string, number>();
  const states: Machine['states'] = [];
  const transitions: Machine['transitions'] = [];
  let checkedTraces = 0;

  const signature = async (prefix: string[]): Promise<string> => {
    const continuations: string[][] = [];
    for (const suffix of suffixes) {
      const outputs = await session.observe([...prefix, ...suffix]);
      continuations.push(outputs.slice(prefix.length));
    }
    return JSON.stringify(continuations);
  };

  const register = async (history: string[]): Promise<number> => {
    const key = await signature(history);
    const known = signatures.get(key);
    if (known !== undefined) return known;
    if (history.length > options.accessDepth) {
      throw new ExplorationError(`Model is not closed within access depth ${options.accessDepth}. Increase access depth to distinguish more states.`, 'NOT_CLOSED');
    }
    const id = states.length;
    signatures.set(key, id);
    states.push({ id, accessSequence: [...history] });
    onProgress?.({ phase: 'learning', queries: session.queries, checkedTraces, states: states.length });
    return id;
  };

  await register([]);
  // Iterate the growing queue of discovered states, rather than every possible history.
  for (let stateId = 0; stateId < states.length; stateId += 1) {
    const state = states[stateId];
    if (!state) throw new Error('State queue is inconsistent');
    for (const action of target.actions) {
      assertActive(signal);
      const nextHistory = [...state.accessSequence, action];
      const outputs = await session.observe(nextHistory);
      const to = await register(nextHistory);
      const output = outputs.at(-1);
      if (output === undefined) throw new ExplorationError('Missing transition output', 'INVALID_ORACLE');
      transitions.push({ from: stateId, action, output, to });
    }
  }
  const machine: Machine = { initialState: 0, states, transitions };
  const findings: Finding[] = [];
  const samples: AnalysisReport['samples'] = [];
  let stoppedEarly = false;
  const seenFailurePrefixes = new Set<string>();
  for (const actions of sequencesThroughDepth(target.actions, options.verifyDepth)) {
    assertActive(signal);
    // Budget exhaustion during verification produces a partial, clearly labelled report.
    let observed: string[];
    try {
      observed = await session.observe(actions);
    } catch (error) {
      if (error instanceof ExplorationError && error.code === 'QUERY_LIMIT') {
        stoppedEarly = true;
        break;
      }
      throw error;
    }
    const predicted = predict(machine, actions);
    checkedTraces += 1;
    // Keep a small, repeatable set of real observations for comparing releases.
    // These traces are already probed during verification; no extra requests.
    if (actions.every((action) => action === actions[0])) {
      samples.push({ actions: [...actions], outputs: [...observed] });
    }
    const firstMismatch = predicted.findIndex((value, i) => value !== observed[i]);
    if (firstMismatch !== -1) {
      // Report only the shortest responsible prefix, not unrelated later actions.
      const prefix = actions.slice(0, firstMismatch + 1);
      const key = JSON.stringify(prefix);
      if (!seenFailurePrefixes.has(key)) {
        seenFailurePrefixes.add(key);
        findings.push({
          actions: prefix,
          predicted: predicted.slice(0, prefix.length),
          observed: observed.slice(0, prefix.length),
          firstMismatch,
        });
      }
      if (findings.length >= options.findingLimit) { stoppedEarly = true; break; }
    }
    if (checkedTraces % 20 === 0) onProgress?.({ phase: 'verifying', queries: session.queries, checkedTraces, states: states.length });
  }

  return {
    target,
    settings: options,
    machine,
    findings,
    samples,
    checkedTraces,
    uniqueQueries: session.queries,
    cacheHits: session.cacheHits,
    durationMs: Date.now() - started,
    stoppedEarly,
    confidenceNote: 'Bounded observational equivalence is not proof of internal state equality. Findings show differences between the learned model and observed behavior; their meaning depends on the target contract. No bug is claimed without a contract-level assertion.',
  };
}
