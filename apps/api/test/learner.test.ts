import { describe, expect, it, vi } from 'vitest';
import { analyze, ExplorationError, QuerySession, validateOptions } from '../src/engine/learner.js';
import { predict, sequenceCount, sequencesThroughDepth } from '../src/engine/sequences.js';
import { BUILTIN_TARGETS, executeTrace } from '../src/sandbox/targets.js';
import { DEFAULTS } from '../src/service/defaults.js';

const target = (id: string) => BUILTIN_TARGETS.find((candidate) => candidate.id === id)!;
const oracle = (id: string) => ({ trace: async (actions: string[]) => executeTrace(id, actions) });

describe('bounded black-box machine learning', () => {
  it('infers all rate-limiter states and discovers the shortest eight-action mismatch', async () => {
    const result = await analyze(target('rate-limiter'), oracle('rate-limiter'), DEFAULTS['rate-limiter']!);
    expect(result.machine.states).toHaveLength(4);
    expect(result.machine.transitions).toHaveLength(8);
    expect(result.findings).toHaveLength(1);
    const counterexample = result.findings[0]!;
    expect(counterexample.actions).toEqual(Array(8).fill('request'));
    expect(counterexample.firstMismatch).toBe(7);
    expect(counterexample.predicted[7]).toBe('denied');
    expect(counterexample.observed[7]).toBe('cooldown');
    expect(result.checkedTraces).toBe(255);
    expect(result.uniqueQueries).toBeLessThanOrEqual(2500);
    expect(predict(result.machine, ['request','request','request','tick','request'])).toEqual(['allowed','allowed','allowed','window-reset','allowed']);
  });

  it('infers five authentication states without inventing a difference', async () => {
    const result = await analyze(target('authentication'), oracle('authentication'), DEFAULTS.authentication!);
    expect(result.machine.states).toHaveLength(5);
    expect(result.machine.transitions).toHaveLength(20);
    expect(result.findings).toHaveLength(0);
    expect(result.checkedTraces).toBe(340);
    expect(result.stoppedEarly).toBe(false);
  });

  it('repeats the same machine and observations for deterministic targets', async () => {
    const first = await analyze(target('rate-limiter'), oracle('rate-limiter'), DEFAULTS['rate-limiter']!);
    const second = await analyze(target('rate-limiter'), oracle('rate-limiter'), DEFAULTS['rate-limiter']!);
    expect(first.machine).toEqual(second.machine);
    expect(first.findings).toEqual(second.findings);
    expect(first.samples).toEqual(second.samples);
    expect(first.uniqueQueries).toBe(second.uniqueQueries);
  });

  it('has a stable breadth-first enumeration order and predictable count', () => {
    expect([...sequencesThroughDepth(['a','b'], 2)]).toEqual([
      ['a'], ['b'], ['a', 'a'], ['a', 'b'], ['b', 'a'], ['b', 'b'],
    ]);
    expect(sequenceCount(4, 4)).toBe(340);
  });

  it('reuses successful traces and returns defensive copies', async () => {
    const probe = vi.fn(async (actions: string[]) => actions.map(() => 'ok'));
    const session = new QuerySession({ trace: probe }, 100);
    const first = await session.observe(['a']);
    first.push('injected');
    expect(await session.observe(['a'])).toEqual(['ok']);
    expect(session.queries).toBe(1);
    expect(session.cacheHits).toBe(1);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed observations, impossible limits and incomplete machines', async () => {
    const session = new QuerySession({ trace: async () => ['unexpected','extra'] }, 100);
    await expect(session.observe(['a'])).rejects.toMatchObject({ code: 'INVALID_ORACLE' });
    expect(() => validateOptions(['a','a'], DEFAULTS.authentication!)).toThrow();
    const options = { ...DEFAULTS['rate-limiter']!, accessDepth: 2 };
    await expect(analyze(target('rate-limiter'), oracle('rate-limiter'), options)).rejects.toMatchObject({ code: 'NOT_CLOSED' });
  });

  it('respects cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(analyze(target('rate-limiter'), oracle('rate-limiter'), DEFAULTS['rate-limiter']!, controller.signal)).rejects.toBeInstanceOf(ExplorationError);
  });

  it('returns an explicit partial result when the budget runs out during checking', async () => {
    const options = { ...DEFAULTS.authentication!, queryLimit: 500 };
    const report = await analyze(target('authentication'), oracle('authentication'), options);
    expect(report.stoppedEarly).toBe(true);
    expect(report.checkedTraces).toBeGreaterThan(0);
    expect(report.uniqueQueries).toBeLessThanOrEqual(500);
  });
});
