import { describe, expect, it } from 'vitest';
import { createDevice, executeTrace } from '../src/sandbox/targets.js';
import { SandboxSessions } from '../src/sandbox/sessions.js';
import { createCatalog } from '../src/sandbox/catalog.js';

describe('isolated sandboxes', () => {
  it('replays the same trace from a clean state', () => {
    const actions = Array(8).fill('request') as string[];
    expect(executeTrace('rate-limiter', actions)).toEqual(executeTrace('rate-limiter', actions));
    expect(executeTrace('rate-limiter', ['request'])).toEqual(['allowed']);
  });

  it('resets quota and long-streak state on tick', () => {
    expect(executeTrace('rate-limiter', [...Array(7).fill('request'), 'tick', 'request'])).toEqual([...Array(3).fill('allowed'), ...Array(4).fill('denied'), 'window-reset', 'allowed']);
  });

  it('requires a challenge, locks after two failures and clears on logout', () => {
    expect(executeTrace('authentication', ['valid','begin','invalid','invalid','valid','logout','begin','valid'])).toEqual([
      'begin-required','challenge','rejected','locked','locked','signed-out','challenge','signed-in',
    ]);
  });

  it('keeps independent live sessions and allows deletion', () => {
    const sessions = new SandboxSessions();
    const one = sessions.create('rate-limiter');
    const two = sessions.create('rate-limiter');
    expect(sessions.step(one, 'request', ['request','tick'])).toBe('allowed');
    expect(sessions.step(two, 'request', ['request','tick'])).toBe('allowed');
    expect(sessions.delete(one)).toBe(true);
    expect(sessions.step(one, 'request', ['request','tick'])).toBeNull();
    expect(() => createDevice('unknown')).toThrow();
  });

  it('rejects unsafe external action alphabets', () => {
    expect(() => createCatalog('http://localhost:3000/trace', 'a,a')).toThrow();
    expect(createCatalog('http://localhost:3000/trace', 'push,pop')).toHaveLength(3);
  });
});
