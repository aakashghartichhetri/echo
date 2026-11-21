import { Prisma, type PrismaClient } from '@prisma/client';
import { analyze, ExplorationError } from '../engine/learner.js';
import { HttpTraceOracle } from '../engine/http-oracle.js';
import type { LearnOptions, TargetDescriptor } from '../engine/types.js';

export class RunQuotaError extends Error {}

/** One worker per deployment. Account limits are checked inside a DB transaction. */
export class RunManager {
  private readonly queue: string[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private processing = false;
  private closed = false;

  constructor(
    private readonly database: PrismaClient,
    private readonly catalog: TargetDescriptor[],
    private readonly baseUrl: string,
    private readonly externalUrl?: string,
    private readonly internalSecret?: string,
    private readonly dailyLimit = 20,
    private readonly allowLocalExternal = false,
  ) {}

  /** Interrupted work is explicit rather than silently lost after a restart. */
  async recover(): Promise<void> {
    await this.database.run.updateMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', error: 'Worker restarted before completing this run', completedAt: new Date() },
    });
  }

  async enqueue(targetId: string, settings: LearnOptions, userId = 'local-demo'): Promise<string> {
    if (this.closed) throw new RunQuotaError('Runner is shutting down');
    if (this.queue.length >= 30) throw new RunQuotaError('Run queue is full. Try again shortly.');
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const run = await this.database.$transaction(async (transaction) => {
      // A database row lock keeps two requests from spending the same daily allowance.
      await transaction.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const [today, active, total] = await Promise.all([
        transaction.run.count({ where: { userId, createdAt: { gte: dayStart } } }),
        transaction.run.count({ where: { userId, status: { in: ['QUEUED', 'RUNNING'] } } }),
        transaction.run.count({ where: { userId } }),
      ]);
      if (total >= 200) throw new RunQuotaError('You have 200 saved runs. Delete older reports to create another.');
      if (today >= this.dailyLimit) throw new RunQuotaError(`Daily limit reached (${this.dailyLimit} runs). Try again tomorrow (UTC).`);
      if (active >= 2) throw new RunQuotaError('You can have at most two pending or active runs.');
      return transaction.run.create({ data: { userId, targetId, status: 'QUEUED', settings: settings as unknown as Prisma.InputJsonValue } });
    });
    this.queue.push(run.id);
    void this.processQueue();
    return run.id;
  }

  async cancel(id: string, userId = 'local-demo'): Promise<'cancelled' | 'not-cancellable' | 'not-found'> {
    const run = await this.database.run.findFirst({ where: { id, userId } });
    if (!run) return 'not-found';
    if (run.status === 'QUEUED') {
      const index = this.queue.indexOf(id);
      if (index >= 0) this.queue.splice(index, 1);
      const updated = await this.database.run.updateMany({
        where: { id, userId, status: 'QUEUED' }, data: { status: 'CANCELLED', completedAt: new Date() },
      });
      return updated.count === 1 ? 'cancelled' : 'not-cancellable';
    }
    if (run.status === 'RUNNING') {
      // Persist cancellation before signalling: late worker results must not win.
      const updated = await this.database.run.updateMany({
        where: { id, userId, status: 'RUNNING' },
        data: { status: 'CANCELLED', completedAt: new Date(), error: 'Cancelled by user' },
      });
      if (!updated.count) return 'not-cancellable';
      this.controllers.get(id)?.abort();
      return 'cancelled';
    }
    return 'not-cancellable';
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    for (const controller of this.controllers.values()) controller.abort();
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.closed) return;
    this.processing = true;
    try {
      while (!this.closed && this.queue.length > 0) {
        const id = this.queue.shift();
        if (!id) continue;
        try { await this.execute(id); }
        catch (error) {
          console.error(JSON.stringify({ event: 'worker_failure', id, message: error instanceof Error ? error.message : 'Unknown error' }));
          try {
            await this.database.run.updateMany({
              where: { id, status: { in: ['QUEUED', 'RUNNING'] } },
              data: { status: 'FAILED', error: 'Unexpected worker failure', completedAt: new Date() },
            });
          } catch { console.error(JSON.stringify({ event: 'worker_database_failure', id })); }
        }
      }
    } finally { this.processing = false; }
  }

  private async execute(id: string): Promise<void> {
    const run = await this.database.run.findUnique({ where: { id } });
    if (!run || run.status !== 'QUEUED') return;
    const target = this.catalog.find((candidate) => candidate.id === run.targetId);
    if (!target) throw new Error('Target is unavailable');
    const controller = new AbortController();
    this.controllers.set(id, controller);
    try {
      const acquired = await this.database.run.updateMany({
        where: { id, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() },
      });
      if (!acquired.count) return;
      const url = run.targetId === 'external' ? this.externalUrl :
        this.internalSecret ? `${this.baseUrl}/api/v1/internal/oracle` : `${this.baseUrl}/api/v1/sandbox/execute`;
      if (!url) throw new Error('No oracle URL configured');
      const oracle = new HttpTraceOracle(url, target.id,
        run.targetId === 'external' ? undefined : this.internalSecret,
        run.targetId !== 'external' || this.allowLocalExternal);
      const report = await analyze(target, oracle, run.settings as unknown as LearnOptions, controller.signal);
      const completed = await this.database.run.updateMany({
        where: { id, status: 'RUNNING' },
        data: {
          status: 'COMPLETED', completedAt: new Date(), report: report as unknown as Prisma.InputJsonValue,
          queries: report.uniqueQueries, casesChecked: report.checkedTraces,
          stateCount: report.machine.states.length, findingCount: report.findings.length,
        },
      });
      if (completed.count) console.info(JSON.stringify({
        event: 'run_completed', id, target: target.id, durationMs: report.durationMs,
        queries: report.uniqueQueries, findings: report.findings.length,
      }));
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof ExplorationError && error.code === 'ABORTED');
      await this.database.run.updateMany({
        where: { id, status: 'RUNNING' },
        data: { status: cancelled ? 'CANCELLED' : 'FAILED', completedAt: new Date(),
          error: cancelled ? 'Cancelled by user' : error instanceof Error ? error.message.slice(0, 200) : 'Unknown exploration failure' },
      });
    } finally { this.controllers.delete(id); }
  }
}
