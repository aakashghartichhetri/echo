import { describe, expect, it } from 'vitest';
import { compactNumber, duration, isActive, nextRefreshDelay, shortId } from './format';

describe('report presentation helpers', () => {
  it('marks only queued and running jobs active', () => {
    expect(isActive('QUEUED')).toBe(true);
    expect(isActive('RUNNING')).toBe(true);
    expect(isActive('COMPLETED')).toBe(false);
    expect(isActive('CANCELLED')).toBe(false);
  });
  it('polls quickly for active jobs and conserves requests when idle', () => {
    expect(nextRefreshDelay(true)).toBe(1800);
    expect(nextRefreshDelay(false)).toBe(15000);
  });
  it('formats durations, large counts and sample labels', () => {
    expect(duration(850)).toBe('850 ms');
    expect(duration(1200)).toBe('1.2 s');
    expect(compactNumber(1250)).toBe('1,250');
    expect(shortId('demo-rate-limiter')).toBe('SAMPLE');
  });
});
