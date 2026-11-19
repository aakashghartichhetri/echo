import type { AnalysisReport, Machine, VerificationSample } from './types.js';

export interface Difference {
  actions: string[];
  baseline: string[];
  candidate: string[];
  mismatchAt: number;
}

export interface Comparison {
  targetId: string;
  baselineId: string;
  candidateId: string;
  comparedStatePairs: number;
  comparedTransitions: number;
  comparedSamples: number;
  modelDifference: Difference | null;
  observedDifference: Difference | null;
  baselineFindings: number;
  candidateFindings: number;
  note: string;
}

function indexTransitions(machine: Machine) {
  return new Map(machine.transitions.map((edge) => [`${edge.from}:${edge.action}`, edge]));
}

function compareModels(baseline: Machine, candidate: Machine, actions: string[]) {
  const first = indexTransitions(baseline);
  const second = indexTransitions(candidate);
  const seen = new Set<string>();
  const queue = [{ a: baseline.initialState, b: candidate.initialState, actions: [] as string[], baseline: [] as string[], candidate: [] as string[] }];
  let comparedTransitions = 0;
  let cursor = 0;
  seen.add(`${baseline.initialState}/${candidate.initialState}`);

  // Breadth-first product traversal finds the shortest disagreement. Repeated
  // state pairs need not be visited again because the machines are deterministic.
  while (cursor < queue.length) {
    const pair = queue[cursor++]!;
    for (const action of actions) {
      const left = first.get(`${pair.a}:${action}`);
      const right = second.get(`${pair.b}:${action}`);
      if (!left || !right) throw new Error('One of the saved models is incomplete');
      comparedTransitions += 1;
      const path = [...pair.actions, action];
      const outputsA = [...pair.baseline, left.output];
      const outputsB = [...pair.candidate, right.output];
      if (left.output !== right.output) {
        return {
          comparedStatePairs: cursor,
          comparedTransitions,
          difference: { actions: path, baseline: outputsA, candidate: outputsB, mismatchAt: path.length - 1 },
        };
      }
      const key = `${left.to}/${right.to}`;
      if (!seen.has(key)) {
        seen.add(key);
        queue.push({ a: left.to, b: right.to, actions: path, baseline: outputsA, candidate: outputsB });
      }
    }
  }
  return { comparedStatePairs: cursor, comparedTransitions, difference: null };
}

function compareSamples(first: VerificationSample[] = [], second: VerificationSample[] = []) {
  const candidateSamples = new Map(second.map((sample) => [JSON.stringify(sample.actions), sample]));
  const sorted = [...first].sort((a, b) => a.actions.length - b.actions.length);
  let checked = 0;
  for (const sample of sorted) {
    const other = candidateSamples.get(JSON.stringify(sample.actions));
    if (!other) continue;
    checked += 1;
    const mismatchAt = sample.outputs.findIndex((output, index) => output !== other.outputs[index]);
    if (mismatchAt !== -1) {
      const length = mismatchAt + 1;
      return {
        checked,
        difference: {
          actions: sample.actions.slice(0, length),
          baseline: sample.outputs.slice(0, length),
          candidate: other.outputs.slice(0, length),
          mismatchAt,
        },
      };
    }
  }
  return { checked, difference: null };
}

/** Compare saved models and actual trace samples; no request reaches a live target. */
export function compareReports(
  baselineId: string,
  baseline: AnalysisReport,
  candidateId: string,
  candidate: AnalysisReport,
): Comparison {
  if (baseline.target.id !== candidate.target.id ||
      JSON.stringify(baseline.target.actions) !== JSON.stringify(candidate.target.actions)) {
    throw new Error('Reports must use the same target and action alphabet');
  }
  const models = compareModels(baseline.machine, candidate.machine, baseline.target.actions);
  const observations = compareSamples(baseline.samples, candidate.samples);
  return {
    targetId: baseline.target.id,
    baselineId,
    candidateId,
    comparedStatePairs: models.comparedStatePairs,
    comparedTransitions: models.comparedTransitions,
    comparedSamples: observations.checked,
    modelDifference: models.difference,
    observedDifference: observations.difference,
    baselineFindings: baseline.findings.length,
    candidateFindings: candidate.findings.length,
    note: 'Comparison uses saved candidate models and a small set of recorded verification traces. Matching models do not prove matching implementations. For a release decision, also review the target contract and run fresh checks.',
  };
}
