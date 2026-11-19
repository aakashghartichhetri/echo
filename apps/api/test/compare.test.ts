import { describe, expect, it } from 'vitest';
import { analyze } from '../src/engine/learner.js';
import { compareReports } from '../src/engine/compare.js';
import { BUILTIN_TARGETS, executeTrace } from '../src/sandbox/targets.js';
import { DEFAULTS } from '../src/service/defaults.js';

const rateTarget = BUILTIN_TARGETS.find((item) => item.id === 'rate-limiter')!;
const options = DEFAULTS['rate-limiter']!;

async function report(mode: 'reference' | 'patched') {
  return analyze(rateTarget, { trace: async (actions) => executeTrace(rateTarget.id, actions, mode) }, options);
}

describe('release comparison', () => {
  it('shows identical saved models and samples for unchanged implementations', async () => {
    const first = await report('reference');
    const result = compareReports('baseline', first, 'candidate', first);
    expect(result.modelDifference).toBeNull();
    expect(result.observedDifference).toBeNull();
    expect(result.comparedSamples).toBeGreaterThan(0);
    expect(result.comparedStatePairs).toBe(4);
  });

  it('detects an eighth-request behavior change even if learned models match', async () => {
    const before = await report('reference');
    const after = await report('patched');
    expect(before.findings).toHaveLength(1);
    expect(after.findings).toHaveLength(0);
    const result = compareReports('baseline', before, 'candidate', after);
    expect(result.modelDifference).toBeNull();
    expect(result.observedDifference?.actions).toEqual(Array(8).fill('request'));
    expect(result.observedDifference?.baseline[7]).toBe('cooldown');
    expect(result.observedDifference?.candidate[7]).toBe('denied');
  });

  it('rejects comparisons across unrelated action alphabets', async () => {
    const before = await report('reference');
    const authTarget = BUILTIN_TARGETS.find((item) => item.id === 'authentication')!;
    const after = await analyze(authTarget, { trace: async (actions) => executeTrace('authentication', actions) }, DEFAULTS.authentication!);
    expect(() => compareReports('one', before, 'two', after)).toThrow('same target');
  });
});
