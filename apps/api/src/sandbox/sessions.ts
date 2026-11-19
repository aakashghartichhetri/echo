import { randomUUID } from 'node:crypto';
import { createDevice, type RateLimiterMode } from './targets.js';

interface Session {
  device: ReturnType<typeof createDevice>;
  targetId: string;
  expiresAt: number;
}

export class SandboxSessions {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly rateLimiterMode: RateLimiterMode = 'reference') {}

  create(targetId: string): string {
    const now = Date.now();
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
    if (this.sessions.size >= 100) throw new Error('Maximum active sandbox sessions reached');
    const id = randomUUID();
    this.sessions.set(id, { device: createDevice(targetId, this.rateLimiterMode), targetId, expiresAt: now + 10 * 60_000 });
    return id;
  }

  step(id: string, action: string, knownActions: readonly string[]): string | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) { this.sessions.delete(id); return null; }
    if (!knownActions.includes(action)) throw new Error('Invalid action');
    session.expiresAt = Date.now() + 10 * 60_000;
    return session.device.step(action);
  }

  getTarget(id: string): string | null { return this.sessions.get(id)?.targetId ?? null; }
  delete(id: string): boolean { return this.sessions.delete(id); }
}
