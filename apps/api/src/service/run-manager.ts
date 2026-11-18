import { Prisma, type PrismaClient } from '@prisma/client';
import { analyze, ExplorationError } from '../engine/learner.js';
import { HttpTraceOracle } from '../engine/http-oracle.js';
import type { LearnOptions, TargetDescriptor } from '../engine/types.js';

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
  ) {}

  /** A restart cannot resume in-memory jobs; mark them explicitly interrupted. */
  async recover(): Promise<void> {
    await this.database.run.updateMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', error: 'Server restarted before this run completed', completedAt: new Date() },
    });
  }

  async enqueue(targetId: string, settings: LearnOptions): Promise<string> {
    if (this.closed) throw new Error('Runner is shutting down');
    if (this.queue.length >= 10) throw new Error('Run queue is full (10 pending runs maximum)');
    const run = await this.database.run.create({ data: { targetId, status: 'QUEUED', settings: settings as unknown as Prisma.InputJsonValue } });
    this.queue.push(run.id);
    // Do not hold an HTTP request open for learning work.
    void this.processQueue();
    return run.id;
  }

  async cancel(id: string): Promise<'cancelled' | 'not-cancellable' | 'not-found'> {
    const run = await this.database.run.findUnique({ where: { id } });
    if (!run) return 'not-found';
    if (run.status === 'QUEUED') {
      const index = this.queue.indexOf(id);
      if (index >= 0) this.queue.splice(index, 1);
      const updated = await this.database.run.updateMany({
        where: { id, status: 'QUEUED' },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      return updated.count === 1 ? 'cancelled' : 'not-cancellable';
    }
    if (run.status === 'RUNNING') {
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
          console.error('Unexpected run worker failure', error);
          try {
            await this.database.run.updateMany({
              where: { id, status: { in: ['QUEUED', 'RUNNING'] } },
              data: { status: 'FAILED', error: 'Unexpected worker failure', completedAt: new Date() },
            });
          } catch (databaseError) { console.error('Could not record worker failure', databaseError); }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async execute(id: string): Promise<void> {
    const run = await this.database.run.findUnique({ where: { id } });
    if (!run || run.status !== 'QUEUED') return;
    const target = this.catalog.find((candidate) => candidate.id === run.targetId);
    if (!target) throw new Error(`Missing target ${run.targetId}`);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    try {
      const acquired = await this.database.run.updateMany({
        where: { id, status: 'QUEUED' },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
      if (acquired.count === 0) return; // A queued cancellation won the race.
      const url = run.targetId === 'external' ? this.externalUrl : `${this.baseUrl}/api/v1/sandbox/execute`;
      if (!url) throw new Error('No oracle URL configured');
      const oracle = new HttpTraceOracle(url, target.id);
      const report = await analyze(target, oracle, run.settings as unknown as LearnOptions, controller.signal);
      await this.database.run.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          report: report as unknown as Prisma.InputJsonValue,
          queries: report.uniqueQueries,
          casesChecked: report.checkedTraces,
          stateCount: report.machine.states.length,
          findingCount: report.findings.length,
        },
      });
      console.info(JSON.stringify({ event: 'run_completed', id, target: target.id, queries: report.uniqueQueries, findings: report.findings.length }));
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof ExplorationError && error.code === 'ABORTED');
      await this.database.run.update({
        where: { id },
        data: {
          status: cancelled ? 'CANCELLED' : 'FAILED',
          completedAt: new Date(),
          error: cancelled ? 'Cancelled by user' : error instanceof Error ? error.message.slice(0, 500) : 'Unknown exploration failure',
        },
      });
    } finally {
      this.controllers.delete(id);
    }
  }
}
