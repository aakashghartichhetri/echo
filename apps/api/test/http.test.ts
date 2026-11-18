import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { BUILTIN_TARGETS } from '../src/sandbox/targets.js';
import type { RunManager } from '../src/service/run-manager.js';

function makeApp() {
  const database = {
    $queryRaw: vi.fn(async () => [{ '?column?': 1 }]),
    run: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
    },
  };
  const manager = { enqueue: vi.fn(async () => '00000000-0000-4000-8000-000000000001'), cancel: vi.fn(async () => 'not-found') };
  const app = createApp(database as unknown as PrismaClient, manager as unknown as RunManager, BUILTIN_TARGETS);
  return { app, database, manager };
}

describe('HTTP API contract', () => {
  it('exposes liveness, readiness and target descriptors', async () => {
    const { app } = makeApp();
    expect((await request(app).get('/api/v1/health/live')).body).toEqual({ status: 'ok' });
    expect((await request(app).get('/api/v1/health/ready')).status).toBe(200);
    expect((await request(app).get('/api/v1/targets')).body).toHaveLength(2);
  });

  it('serves deterministic traces with one output per action', async () => {
    const { app } = makeApp();
    const response = await request(app).post('/api/v1/sandbox/execute').send({ targetId: 'rate-limiter', actions: Array(8).fill('request') });
    expect(response.status).toBe(200);
    expect(response.body.outputs).toHaveLength(8);
    expect(response.body.outputs[7]).toBe('cooldown');
  });

  it('isolates stateful sessions and rejects invalid actions', async () => {
    const { app } = makeApp();
    const created = await request(app).post('/api/v1/sandbox/sessions').send({ targetId: 'authentication' });
    expect(created.status).toBe(201);
    const id = created.body.sessionId as string;
    expect((await request(app).post(`/api/v1/sandbox/sessions/${id}/actions`).send({ action: 'valid' })).body.output).toBe('begin-required');
    expect((await request(app).post(`/api/v1/sandbox/sessions/${id}/actions`).send({ action: 'invalid-action' })).status).toBe(400);
    expect((await request(app).delete(`/api/v1/sandbox/sessions/${id}`)).status).toBe(204);
    expect((await request(app).post(`/api/v1/sandbox/sessions/${id}/actions`).send({ action: 'begin' })).status).toBe(404);
  });

  it('validates run creation and returns accepted jobs quickly', async () => {
    const { app, manager } = makeApp();
    expect((await request(app).post('/api/v1/runs').send({ targetId: 'rate-limiter', settings: { accessDepth: -1 } })).status).toBe(400);
    expect((await request(app).post('/api/v1/runs').send({ targetId: 'nope' })).status).toBe(404);
    const response = await request(app).post('/api/v1/runs').send({ targetId: 'rate-limiter' });
    expect(response.status).toBe(202);
    expect(manager.enqueue).toHaveBeenCalledOnce();
    expect(response.body.id).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('has safe errors, body caps and API-only 404s', async () => {
    const { app } = makeApp();
    expect((await request(app).post('/api/v1/sandbox/execute').send({ targetId: 'rate-limiter', actions: ['bad'] })).status).toBe(400);
    expect((await request(app).get('/api/v1/runs/not-an-id')).status).toBe(400);
    expect((await request(app).get('/api/v1/unknown')).status).toBe(404);
    expect((await request(app).post('/api/v1/sandbox/execute').set('Content-Type', 'application/json').send('{broken')).status).toBe(400);
    const result = await request(app).get('/api/v1/targets');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['x-powered-by']).toBeUndefined();
  });
});
