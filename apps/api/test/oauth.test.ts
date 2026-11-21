import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import type { RunManager } from '../src/service/run-manager.js';
import { BUILTIN_TARGETS } from '../src/sandbox/targets.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

const COOKIE = (header: string) => header.split(';', 1)[0]!;

describe('GitHub sign-in and session boundary', () => {
  it('requires an authenticated account and checks CSRF on writes', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_MODE', 'github');
    vi.stubEnv('PUBLIC_ORIGIN', 'https://echo.example.com');
    vi.stubEnv('GITHUB_CLIENT_ID', 'gh-client-id');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'gh-client-secret');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(48));
    vi.stubEnv('INTERNAL_ORACLE_SECRET', 'b'.repeat(48));
    vi.stubEnv('ECHO_EXTERNAL_URL', '');
    vi.resetModules();

    const { createApp } = await import('../src/app.js');
    let storedHash = '';
    const account = { id: 'user-alice', githubId: '123', login: 'alice', displayName: 'Alice', avatarUrl: null };
    const database = {
      user: { upsert: vi.fn(async () => account) },
      session: {
        // A user can have several sessions; sign-in prunes the older ones.
        findMany: vi.fn(async () => [{ tokenHash: 'c'.repeat(64) }]),
        deleteMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async (args: { data: { tokenHash: string } }) => { storedHash = args.data.tokenHash; }),
        findUnique: vi.fn(async (args: { where: { tokenHash: string } }) =>
          args.where.tokenHash === storedHash ? { userId: account.id, expiresAt: new Date(Date.now() + 86400000), user: account } : null),
      },
    };
    const app = createApp(database as unknown as PrismaClient, {} as RunManager, BUILTIN_TARGETS);
    expect((await request(app).get('/api/v1/targets')).status).toBe(401);
    expect((await request(app).post('/api/v1/internal/oracle').send({ targetId: 'rate-limiter', actions: ['request'] })).status).toBe(403);

    const login = await request(app).get('/api/v1/auth/login');
    expect(login.status).toBe(302);
    const stateCookie = COOKIE((login.headers['set-cookie'] as string[])[0]!);
    const state = new URL(login.headers.location as string).searchParams.get('state');
    expect(state).toBeTruthy();

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('access_token')) return new Response(JSON.stringify({ access_token: 'gh-test-token-long-enough' }), { status: 200 });
      if (url.includes('/user')) return new Response(JSON.stringify({ id: 123, login: 'alice' }), { status: 200 });
      return new Response('Not found', { status: 404 });
    }));
    const callback = await request(app).get(`/api/v1/auth/callback?code=test-code&state=${state}`).set('Cookie', stateCookie);
    expect(callback.status).toBe(303);
    expect(database.session.findMany).toHaveBeenCalledWith({
      where: { userId: account.id },
      orderBy: { createdAt: 'desc' },
      skip: 9,
      select: { tokenHash: true },
    });
    expect(database.session.deleteMany).toHaveBeenCalledWith({
      where: { tokenHash: { in: ['c'.repeat(64)] } },
    });
    expect(database.session.create).toHaveBeenCalledOnce();
    const cookies = callback.headers['set-cookie'] as string[];
    const sessionCookie = COOKIE(cookies.find((c) => c.startsWith('__Host-echo-session='))!);
    expect(sessionCookie).toMatch(/^__Host-echo-session=/);
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedHash).not.toContain(sessionCookie.slice(sessionCookie.indexOf('=') + 1));

    const me = await request(app).get('/api/v1/auth/me').set('Cookie', sessionCookie);
    expect(me.status).toBe(200);
    expect(me.body.user.login).toBe('alice');
    const csrf = me.body.csrfToken as string;
    expect(csrf).toMatch(/^[a-f0-9]{64}$/);
    const input = { targetId: 'rate-limiter', actions: ['request'] };
    expect((await request(app).post('/api/v1/sandbox/execute').set('Cookie', sessionCookie).send(input)).status).toBe(403);
    const trace = await request(app).post('/api/v1/sandbox/execute')
      .set('Cookie', sessionCookie).set('Origin', 'https://echo.example.com').set('x-csrf-token', csrf).send(input);
    expect(trace.status).toBe(200);
    expect(trace.body.outputs).toEqual(['allowed']);
    expect((await request(app).get('/api/v1/targets').set('Cookie', sessionCookie)).status).toBe(200);
  });
});

describe('GitHub OAuth failure handling', () => {
  async function appInHostedMode(database: object) {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_MODE', 'github');
    vi.stubEnv('PUBLIC_ORIGIN', 'https://echo.example.com');
    vi.stubEnv('GITHUB_CLIENT_ID', 'test-client');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'test-secret');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(48));
    vi.stubEnv('INTERNAL_ORACLE_SECRET', 'b'.repeat(48));
    vi.stubEnv('ECHO_EXTERNAL_URL', '');
    vi.resetModules();
    const { createApp } = await import('../src/app.js');
    return createApp(database as PrismaClient, {} as RunManager, BUILTIN_TARGETS);
  }

  it('rejects missing or incorrect OAuth state without calling GitHub', async () => {
    const app = await appInHostedMode({});
    const githubFetch = vi.fn();
    vi.stubGlobal('fetch', githubFetch);
    expect((await request(app).get('/api/v1/auth/callback?code=test&state=invalid')).status).toBe(400);
    const login = await request(app).get('/api/v1/auth/login');
    const stateCookie = COOKIE((login.headers['set-cookie'] as string[])[0]!);
    expect((await request(app).get(`/api/v1/auth/callback?code=test&state=${'x'.repeat(43)}`)
      .set('Cookie', stateCookie)).status).toBe(400);
    expect(githubFetch).not.toHaveBeenCalled();
  });

  it('rejects expired sessions and clears their browser cookie', async () => {
    const app = await appInHostedMode({ session: {
      findUnique: vi.fn(async () => ({ userId: 'alice', expiresAt: new Date(0), user: { id: 'alice' } })),
    } });
    const response = await request(app).get('/api/v1/auth/me')
      .set('Cookie', `__Host-echo-session=${'t'.repeat(43)}`);
    expect(response.status).toBe(401);
    expect((response.headers['set-cookie'] as string[]).join(' ')).toContain('Max-Age=0');
  });
});
