import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import type { RunManager } from '../src/service/run-manager.js';
import { createApp } from '../src/app.js';
import { BUILTIN_TARGETS } from '../src/sandbox/targets.js';

const cursor = '00000000-0000-4000-8000-000000000008';

describe('scoped cursor pagination', () => {
  it('rejects a cursor owned by another account', async () => {
    const database = { run: {
      findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []),
    } };
    const app = createApp(database as unknown as PrismaClient, {} as RunManager, BUILTIN_TARGETS);
    expect((await request(app).get(`/api/v1/runs?cursor=${cursor}`)).status).toBe(404);
    expect(database.run.findFirst).toHaveBeenCalledWith({
      where: { id: cursor, userId: 'local-demo' }, select: { id: true },
    });
    expect(database.run.findMany).not.toHaveBeenCalled();
  });

  it('uses stable ordering and a bounded page size', async () => {
    const database = { run: {
      findFirst: vi.fn(async () => ({ id: cursor })), findMany: vi.fn(async () => []),
    } };
    const app = createApp(database as unknown as PrismaClient, {} as RunManager, BUILTIN_TARGETS);
    expect((await request(app).get(`/api/v1/runs?cursor=${cursor}&limit=10`)).status).toBe(200);
    expect(database.run.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'local-demo' }, cursor: { id: cursor }, skip: 1,
      take: 10, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
    expect((await request(app).get('/api/v1/runs?limit=51')).status).toBe(400);
  });
});
