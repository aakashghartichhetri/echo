import type { TargetDescriptor } from '../engine/types.js';

export const BUILTIN_TARGETS: TargetDescriptor[] = [
  {
    id: 'rate-limiter',
    name: 'Rate limiter',
    summary: 'A fixed-window quota with a hidden long-streak response.',
    contract: 'Three requests are allowed per window. Further requests must be denied until tick resets the window.',
    actions: ['request', 'tick'],
    expectedAnomaly: true,
  },
  {
    id: 'authentication',
    name: 'Authentication flow',
    summary: 'A challenge, invalid attempts, lockout, sign-in, and sign-out.',
    contract: 'Begin starts a challenge; valid succeeds, two invalid submissions lock the session, and logout clears the session.',
    actions: ['begin', 'valid', 'invalid', 'logout'],
    expectedAnomaly: false,
  },
];

interface Device {
  step(action: string): string;
}

/** The targets live outside the engine; only the HTTP interface connects them. */
export function createDevice(targetId: string): Device {
  if (targetId === 'rate-limiter') {
    let used = 0;
    let streak = 0;
    return {
      step(action: string): string {
        if (action === 'tick') { used = 0; streak = 0; return 'window-reset'; }
        if (action !== 'request') throw new Error('Invalid rate-limiter action');
        streak += 1;
        if (used < 3) { used += 1; return 'allowed'; }
        // Intentionally undocumented: after prolonged rejection, the target
        // sends a different response even though the contract promises 'denied'.
        if (streak >= 8) return 'cooldown';
        return 'denied';
      },
    };
  }
  if (targetId === 'authentication') {
    type Mode = 'guest' | 'challenge' | 'authenticated' | 'locked';
    let mode: Mode = 'guest';
    let failures = 0;
    return {
      step(action: string): string {
        if (action === 'logout') { mode = 'guest'; failures = 0; return 'signed-out'; }
        if (mode === 'locked') return 'locked';
        if (mode === 'authenticated') return 'already-signed-in';
        if (action === 'begin') {
          if (mode === 'guest') { mode = 'challenge'; failures = 0; }
          return 'challenge';
        }
        if (mode === 'guest') return 'begin-required';
        if (action === 'valid') { mode = 'authenticated'; return 'signed-in'; }
        if (action === 'invalid') {
          failures += 1;
          if (failures >= 2) { mode = 'locked'; return 'locked'; }
          return 'rejected';
        }
        throw new Error('Invalid authentication action');
      },
    };
  }
  throw new Error('Unknown sandbox target');
}

export function executeTrace(targetId: string, actions: string[]): string[] {
  const device = createDevice(targetId);
  return actions.map((action) => device.step(action));
}
