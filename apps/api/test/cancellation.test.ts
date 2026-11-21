import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { analyze } from '../src/engine/learner.js';
import { RunManager } from '../src/service/run-manager.js';
import { BUILTIN_TARGETS } from '../src/sandbox/targets.js';
import { DEFAULTS } from '../src/service/defaults.js';
import type { AnalysisReport } from '../src/engine/types.js';

vi.mock('../src/engine/learner.js', async (original) => ({
  ...(await original<typeof import('../src/engine/learner.js')>()),
  analyze: vi.fn(),
}));

const id = '00000000-0000-4000-8000-000000000555';

describe('experiment cancellation races', () => {
  it('persists cancellation and ignores a late successful worker result', async () => {
    const run = {
      id, userId: 'local-demo', targetId: 'rate-limiter', status: 'QUEUED',
      settings: DEFAULTS['rate-limiter']!, completedAt: null as Date | null,
    };
    const updateMany = vi.fn(async (args: { where: { status: string; id: string }; data: Record<string, unknown> }) => {
      if (args.where.id !== run.id || args.where.status !== run.status) return { count: 0 };
      Object.assign(run, args.data);
      return { count: 1 };
    });
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: 'local-demo' }]),
      run: {
        count: vi.fn(async () => 0),
        create: vi.fn(async () => run),
      },
    };
    const database = {
      $transaction: vi.fn(async (fn: (tx: typeof transaction) => Promise<unknown>) => fn(transaction)),
      run: {
        updateMany,
        findUnique: vi.fn(async () => run),
        findFirst: vi.fn(async () => run),
      },
    };
    let finish!: (report: AnalysisReport) => void;
    vi.mocked(analyze).mockImplementation(() => new Promise<AnalysisReport>((resolve) => { finish = resolve; }));
    const manager = new RunManager(database as unknown as PrismaClient, BUILTIN_TARGETS,
      'http://127.0.0.1:3001', undefined, 'test-secret');
    await manager.enqueue('rate-limiter', DEFAULTS['rate-limiter']!);
    for (let tries = 0; tries < 100 && (run.status !== 'RUNNING' || vi.mocked(analyze).mock.calls.length === 0); tries++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(run.status).toBe('RUNNING');
    expect(analyze).toHaveBeenCalledOnce();
    expect(await manager.cancel(id, 'local-demo')).toBe('cancelled');
    expect(run.status).toBe('CANCELLED');
    expect(await manager.cancel(id, 'local-demo')).toBe('not-cancellable');
    const target = BUILTIN_TARGETS[0]!;
    finish({
      target, settings: DEFAULTS['rate-limiter']!, machine: { initialState: 0, states: [], transitions: [] },
      findings: [], samples: [], checkedTraces: 0, uniqueQueries: 0, cacheHits: 0,
      durationMs: 5, stoppedEarly: false, confidenceNote: '',
    });
    for (let tries = 0; tries < 100 && updateMany.mock.calls.length < 3; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(run.status).toBe('CANCELLED');
    expect(run.completedAt).toBeInstanceOf(Date);
    await manager.shutdown();
  });
});
