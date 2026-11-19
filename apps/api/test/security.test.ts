import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { hashToken, safeEqual, csrfToken } from '../src/security/auth.js';

describe('session integrity helpers', () => {
  it('hashes opaque session tokens before database persistence', () => {
    const raw = 'A'.repeat(43);
    expect(hashToken(raw)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(raw)).not.toContain(raw);
    expect(hashToken(raw)).not.toBe(hashToken('B'.repeat(43)));
  });

  it('uses fixed-time equality for supplied tokens', () => {
    expect(safeEqual('correct', 'correct')).toBe(true);
    expect(safeEqual('correct', 'wrong')).toBe(false);
    expect(safeEqual('correct', 'correctX')).toBe(false);
  });

  it('binds CSRF proof to each session secret', () => {
    expect(csrfToken('session-one')).toMatch(/^[a-f0-9]{64}$/);
    expect(csrfToken('session-one')).toBe(csrfToken('session-one'));
    expect(csrfToken('session-one')).not.toBe(csrfToken('session-two'));
    expect(csrfToken('session-one')).not.toBe(createHmac('sha256', 'wrong-secret').update('session-one').digest('hex'));
  });
});
