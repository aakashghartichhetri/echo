import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/** CI runs this test against a real PostgreSQL service, never a mock. */
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('PostgreSQL persistence', () => {
  it('creates, queries and deletes a run', async () => {
    const database = new PrismaClient();
    let id: string | undefined;
    try {
      const created = await database.run.create({ data: {
        userId: 'local-demo', targetId: 'rate-limiter', status: 'QUEUED', settings: {
          accessDepth: 3, suffixDepth: 3, verifyDepth: 8, queryLimit: 2500, findingLimit: 1,
        },
      } });
      id = created.id;
      expect((await database.run.findUnique({ where: { id } }))?.status).toBe('QUEUED');
      await database.run.update({ where: { id }, data: { status: 'COMPLETED', queries: 21, report: { findings: [] } } });
      const loaded = await database.run.findUnique({ where: { id } });
      expect(loaded?.queries).toBe(21);
      expect(loaded?.report).toEqual({ findings: [] });
    } finally {
      if (id) await database.run.delete({ where: { id } });
      await database.$disconnect();
    }
  });
});

// The test below exercises the real queue worker, HTTP oracle and Prisma writes.
// It runs in CI where PostgreSQL is provided as a service.
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('RunManager integration', () => {
  it('completes an asynchronous run and persists its inferred model', async () => {
    const { createServer } = await import('node:http');
    const { BUILTIN_TARGETS, executeTrace } = await import('../src/sandbox/targets.js');
    const { DEFAULTS } = await import('../src/service/defaults.js');
    const { RunManager } = await import('../src/service/run-manager.js');
    const database = new PrismaClient();
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const data = JSON.parse(Buffer.concat(chunks).toString()) as { targetId: string; actions: string[] };
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ outputs: executeTrace(data.targetId, data.actions) }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not open test HTTP server');
    const manager = new RunManager(database, BUILTIN_TARGETS, `http://127.0.0.1:${address.port}`);
    let id: string | undefined;
    try {
      id = await manager.enqueue('rate-limiter', DEFAULTS['rate-limiter']!);
      let finalStatus = '';
      for (let attempt = 0; attempt < 150; attempt++) {
        const run = await database.run.findUnique({ where: { id } });
        finalStatus = run?.status ?? 'MISSING';
        if (finalStatus === 'COMPLETED' || finalStatus === 'FAILED') break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(finalStatus).toBe('COMPLETED');
      const run = await database.run.findUnique({ where: { id } });
      expect(run?.stateCount).toBe(4);
      expect(run?.findingCount).toBe(1);
      expect(run?.queries).toBeGreaterThan(0);
    } finally {
      await manager.shutdown();
      if (id) await database.run.deleteMany({ where: { id } });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.$disconnect();
    }
  }, 25000);
});
