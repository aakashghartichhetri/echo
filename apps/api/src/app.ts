import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { AnalysisReport, TargetDescriptor } from './engine/types.js';
import { compareReports } from './engine/compare.js';
import type { RateLimiterMode } from './sandbox/targets.js';
import { validateOptions } from './engine/learner.js';
import { executeTrace } from './sandbox/targets.js';
import { SandboxSessions } from './sandbox/sessions.js';
import { DEFAULTS } from './service/defaults.js';
import { RunManager, RunQuotaError } from './service/run-manager.js';
import { config } from './config.js';
import { authenticate, registerAuthRoutes, requireCsrf, safeEqual } from './security/auth.js';

const uuid = z.string().uuid();
const bodyForRun = z.object({
  targetId: z.string().max(40),
  settings: z.object({
    accessDepth: z.number().int().min(2).max(6),
    suffixDepth: z.number().int().min(1).max(4),
    verifyDepth: z.number().int().min(1).max(9),
    queryLimit: z.number().int().min(100).max(20000),
    findingLimit: z.number().int().min(1).max(5),
  }).strict().optional(),
}).strict();
const traceBody = z.object({
  targetId: z.string(),
  actions: z.array(z.string()).max(12),
}).strict();

/** Defense-in-depth for demo write endpoints. Does not protect a public deployment. */
function createLocalRateLimit(maxRequests: number): RequestHandler {
  const counters = new Map<string, { count: number; expires: number }>();
  return (request, response, next) => {
    const now = Date.now();
    if (counters.size > 2000) for (const [key, value] of counters) if (value.expires < now) counters.delete(key);
    const key = request.ip ?? 'unknown';
    const entry = counters.get(key);
    if (!entry || entry.expires < now) { counters.set(key, { count: 1, expires: now + 60_000 }); next(); return; }
    entry.count += 1;
    if (entry.count > maxRequests) { response.status(429).json({ error: 'Too many requests. Try again shortly.' }); return; }
    next();
  };
}

export function createApp(database: PrismaClient, manager: RunManager, catalog: TargetDescriptor[], rateLimiterMode: RateLimiterMode = 'reference') {
  const app = express();
  const sessions = new SandboxSessions(rateLimiterMode);
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.use(express.json({ limit: '8kb' }));
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
    if (_request.path.startsWith('/api/')) response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Request-Id', randomUUID());
    next();
  });

  app.get('/api/v1/health/live', (_request, response) => response.json({ status: 'ok' }));
  app.get('/api/v1/health/ready', createLocalRateLimit(120), async (_request, response, next) => {
    try { await database.$queryRaw`SELECT 1`; response.json({ status: 'ready' }); }
    catch (error) { next(error); }
  });
  // The worker uses this one authenticated internal endpoint. It never uses a user's cookie.
  app.post('/api/v1/internal/oracle', (request, response) => {
    const secret = config.INTERNAL_ORACLE_SECRET ?? 'local-internal-oracle';
    if (!safeEqual(request.get('x-echo-internal-secret') ?? '', secret)) {
      response.status(403).json({ error: 'Forbidden' }); return;
    }
    const parsed = traceBody.safeParse(request.body);
    if (!parsed.success || !['rate-limiter', 'authentication'].includes(parsed.data.targetId)) {
      response.status(400).json({ error: 'Invalid internal trace' }); return;
    }
    const target = catalog.find((item) => item.id === parsed.data.targetId);
    if (!target || parsed.data.actions.some((action) => !target.actions.includes(action))) {
      response.status(400).json({ error: 'Invalid actions' }); return;
    }
    response.json({ outputs: executeTrace(target.id, parsed.data.actions, rateLimiterMode) });
  });

  // Bound unauthenticated OAuth redirects before account lookup.
  app.use('/api/v1/auth', createLocalRateLimit(50));
  registerAuthRoutes(app, database);
  // Application endpoints are private. Session cookies alone are not enough for writes.
  app.use('/api/v1', createLocalRateLimit(5000), authenticate(database), requireCsrf);
  app.delete('/api/v1/account', async (request, response, next) => {
    if (config.AUTH_MODE !== 'github') { response.status(403).json({ error: 'Demo account cannot be deleted' }); return; }
    if (request.body?.confirm !== 'DELETE') { response.status(400).json({ error: 'Send {"confirm":"DELETE"} to remove your account and saved reports' }); return; }
    try {
      const activeRuns = await database.run.count({ where: { userId: response.locals.userId, status: { in: ['QUEUED', 'RUNNING'] } } });
      if (activeRuns > 0) { response.status(409).json({ error: 'Cancel or finish active runs before deleting your account' }); return; }
      await database.user.delete({ where: { id: response.locals.userId } });
      response.append('Set-Cookie', '__Host-echo-session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      response.status(204).end();
    } catch (error) { next(error); }
  });
  app.get('/api/v1/targets', (_request, response) => response.json(catalog));
  app.get('/api/v1/account/usage', async (_request, response, next) => {
    try {
      const now = new Date(); now.setUTCHours(0, 0, 0, 0);
      const today = await database.run.count({ where: { userId: response.locals.userId, createdAt: { gte: now } } });
      response.json({ usedToday: today, dailyLimit: config.DAILY_RUN_LIMIT });
    } catch (error) { next(error); }
  });

  // This replay endpoint is the black-box boundary. Each request gets fresh state.
  app.post('/api/v1/sandbox/execute', (request, response) => {
    const parsed = traceBody.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'Provide targetId and an actions array (maximum 12)' }); return; }
    const target = catalog.find((candidate) => candidate.id === parsed.data.targetId && candidate.id !== 'external');
    if (!target) { response.status(404).json({ error: 'Unknown built-in target' }); return; }
    if (parsed.data.actions.some((action) => !target.actions.includes(action))) {
      response.status(400).json({ error: `Allowed actions: ${target.actions.join(', ')}` }); return;
    }
    response.json({ outputs: executeTrace(target.id, parsed.data.actions, rateLimiterMode) });
  });

  app.post('/api/v1/sandbox/sessions', createLocalRateLimit(30), (request, response) => {
    if (config.AUTH_MODE === 'github') { response.status(403).json({ error: 'Use replay traces in the hosted service' }); return; }
    const parsed = z.object({ targetId: z.string() }).strict().safeParse(request.body);
    const target = parsed.success ? catalog.find((item) => item.id === parsed.data.targetId && item.id !== 'external') : null;
    if (!target) { response.status(400).json({ error: 'Specify a valid built-in targetId' }); return; }
    try { response.status(201).json({ sessionId: sessions.create(target.id), targetId: target.id }); }
    catch { response.status(429).json({ error: 'Sandbox session capacity reached' }); }
  });
  app.post('/api/v1/sandbox/sessions/:id/actions', (request, response) => {
    if (config.AUTH_MODE === 'github') { response.status(403).json({ error: 'Use replay traces in the hosted service' }); return; }
    const parsed = z.object({ action: z.string() }).strict().safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'Specify one action' }); return; }
    const targetId = sessions.getTarget(request.params.id);
    const target = catalog.find((item) => item.id === targetId);
    if (!target) { response.status(404).json({ error: 'Unknown or expired session' }); return; }
    if (!target.actions.includes(parsed.data.action)) { response.status(400).json({ error: 'Invalid action' }); return; }
    const output = sessions.step(request.params.id, parsed.data.action, target.actions);
    if (output === null) { response.status(404).json({ error: 'Unknown or expired session' }); return; }
    response.json({ output });
  });
  app.delete('/api/v1/sandbox/sessions/:id', (request, response) => {
    if (config.AUTH_MODE === 'github') { response.status(403).json({ error: 'Use replay traces in the hosted service' }); return; }
    if (!sessions.delete(request.params.id)) { response.status(404).json({ error: 'Unknown session' }); return; }
    response.status(204).end();
  });

  app.get('/api/v1/runs', async (request, response, next) => {
    const parsed = z.coerce.number().int().min(1).max(50).safeParse(request.query.limit ?? 25);
    if (!parsed.success) { response.status(400).json({ error: 'limit must be 1–50' }); return; }
    try {
      const runs = await database.run.findMany({ where: { userId: response.locals.userId }, orderBy: { createdAt: 'desc' }, take: parsed.data,
        select: { id: true, targetId: true, status: true, createdAt: true, completedAt: true, stateCount: true, queries: true, casesChecked: true, findingCount: true },
      });
      response.json(runs);
    } catch (error) { next(error); }
  });

  app.get('/api/v1/runs/:id/compare/:baselineId', async (request, response, next) => {
    const isRunId = (id: string) => uuid.safeParse(id).success ||
      ['demo-rate-limiter', 'demo-authentication'].includes(id);
    if (!isRunId(request.params.id) || !isRunId(request.params.baselineId)) {
      response.status(400).json({ error: 'Invalid run ID' }); return;
    }
    try {
      const [candidate, baseline] = await Promise.all([
        database.run.findFirst({ where: { id: request.params.id, userId: response.locals.userId } }),
        database.run.findFirst({ where: { id: request.params.baselineId, userId: response.locals.userId } }),
      ]);
      if (!candidate || !baseline) { response.status(404).json({ error: 'Report not found' }); return; }
      if (candidate.status !== 'COMPLETED' || baseline.status !== 'COMPLETED' || !candidate.report || !baseline.report) {
        response.status(409).json({ error: 'Both runs must be completed before comparing' }); return;
      }
      if (candidate.targetId !== baseline.targetId) {
        response.status(409).json({ error: 'Choose two runs of the same target' }); return;
      }
      const result = compareReports(
        baseline.id, baseline.report as unknown as AnalysisReport,
        candidate.id, candidate.report as unknown as AnalysisReport,
      );
      response.json(result);
    } catch (error) { next(error); }
  });

  app.get('/api/v1/runs/:id', async (request, response, next) => {
    const parsed = uuid.safeParse(request.params.id);
    if (!parsed.success && !['demo-rate-limiter', 'demo-authentication'].includes(request.params.id)) {
      response.status(400).json({ error: 'Invalid run ID' }); return;
    }
    try {
      const run = await database.run.findFirst({ where: { id: request.params.id, userId: response.locals.userId } });
      if (!run) { response.status(404).json({ error: 'Run not found' }); return; }
      response.json(run);
    } catch (error) { next(error); }
  });

  app.post('/api/v1/runs', createLocalRateLimit(15), async (request, response, next) => {
    const parsed = bodyForRun.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'Invalid run settings', details: parsed.error.flatten() }); return; }
    const target = catalog.find((item) => item.id === parsed.data.targetId);
    if (!target) { response.status(404).json({ error: 'Unknown target' }); return; }
    const settings = parsed.data.settings ?? DEFAULTS[target.id];
    if (!settings) { response.status(500).json({ error: 'Missing default target settings' }); return; }
    try {
      validateOptions(target.actions, settings);
      if (config.AUTH_MODE === 'github' && settings.queryLimit > 3000) {
        response.status(400).json({ error: 'Hosted workspaces allow up to 3,000 queries per experiment' }); return;
      }
      const id = await manager.enqueue(target.id, settings, response.locals.userId);
      response.status(202).json({ id, status: 'QUEUED' });
    } catch (error) {
      if (error instanceof RunQuotaError) { response.status(429).json({ error: error.message }); return; }
      next(error);
    }
  });

  app.post('/api/v1/runs/:id/cancel', async (request, response, next) => {
    if (!uuid.safeParse(request.params.id).success) { response.status(400).json({ error: 'Invalid run ID' }); return; }
    try {
      const result = await manager.cancel(request.params.id, response.locals.userId);
      if (result === 'not-found') { response.status(404).json({ error: 'Run not found' }); return; }
      if (result === 'not-cancellable') { response.status(409).json({ error: 'Run is already finished' }); return; }
      response.status(202).json({ status: 'CANCELLING' });
    } catch (error) { next(error); }
  });

  app.delete('/api/v1/runs/:id', async (request, response, next) => {
    if (!uuid.safeParse(request.params.id).success) { response.status(400).json({ error: 'Invalid run ID' }); return; }
    try {
      const run = await database.run.findFirst({ where: { id: request.params.id, userId: response.locals.userId } });
      if (!run) { response.status(404).json({ error: 'Run not found' }); return; }
      if (run.status === 'QUEUED' || run.status === 'RUNNING') { response.status(409).json({ error: 'Cancel the run before deleting' }); return; }
      await database.run.deleteMany({ where: { id: run.id, userId: response.locals.userId } });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.use('/api', (_request, response) => response.status(404).json({ error: 'API endpoint not found' }));
  // Workspace scripts change process.cwd(), so resolve assets relative to this module.
  const webDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(path.join(webDirectory, 'index.html'))) {
    app.use(express.static(webDirectory, {
      setHeaders(response, filePath) {
        // Vite fingerprints asset names. Immutable caching speeds up repeat visits
        // without making index.html stale after a new deployment.
        const isFingerprintedAsset = path.relative(webDirectory, filePath).startsWith(`assets${path.sep}`);
        response.setHeader('Cache-Control', isFingerprintedAsset
          ? 'public, max-age=31536000, immutable'
          : 'no-cache');
      },
    }));
    app.get('*', (_request, response) => {
      response.setHeader('Cache-Control', 'no-cache');
      response.sendFile(path.join(webDirectory, 'index.html'));
    });
  }
  app.use((_request, response) => response.status(404).json({ error: 'Not found' }));

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof SyntaxError && 'body' in error) { response.status(400).json({ error: 'Malformed JSON' }); return; }
    console.error(JSON.stringify({ event: 'request_error', message: error instanceof Error ? error.message : String(error) }));
    response.status(500).json({ error: 'Internal server error' });
  };
  app.use(errorHandler);
  return app;
}
