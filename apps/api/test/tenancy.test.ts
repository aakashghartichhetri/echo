import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { BUILTIN_TARGETS } from '../src/sandbox/targets.js';
import type { RunManager } from '../src/service/run-manager.js';

// Runs in GitHub Actions with a real PostgreSQL service, not a mocked userId filter.
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('tenant isolation (PostgreSQL)', () => {
  const database = new PrismaClient();
  afterAll(async () => { await database.$disconnect(); });

  it('does not expose another user\'s runs, comparison, or cancellation', async () => {
    const owner = await database.user.create({ data: { login: 'isolated-owner', displayName: 'Isolated Owner' } });
    const foreign = await database.run.create({ data: { userId: owner.id, targetId: 'rate-limiter', status: 'COMPLETED', settings: {}, report: { findings: [] } } });
    const app = createApp(database, { cancel: async () => 'not-found' } as unknown as RunManager, BUILTIN_TARGETS);
    try {
      expect((await request(app).get(`/api/v1/runs/${foreign.id}`)).status).toBe(404);
      expect((await request(app).get(`/api/v1/runs/${foreign.id}/compare/${foreign.id}`)).status).toBe(404);
      expect((await request(app).post(`/api/v1/runs/${foreign.id}/cancel`)).status).toBe(404);
      const visible = (await request(app).get('/api/v1/runs')).body as { id: string }[];
      expect(visible.some((entry) => entry.id === foreign.id)).toBe(false);
      expect((await request(app).delete(`/api/v1/runs/${foreign.id}`)).status).toBe(404);
    } finally {
      await database.user.delete({ where: { id: owner.id } });
    }
  });
});
