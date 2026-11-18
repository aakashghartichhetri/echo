
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { TargetDescriptor } from './engine/types.js';
import { validateOptions } from './engine/learner.js';
import { executeTrace } from './sandbox/targets.js';
import { SandboxSessions } from './sandbox/sessions.js';
import { DEFAULTS } from './service/defaults.js';
import { RunManager } from './service/run-manager.js';

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

    if (counters.size > 2000) {
      for (const [key, value] of counters) {
        if (value.expires < now) counters.delete(key);
      }
    }

    const key = request.ip ?? 'unknown';
    const entry = counters.get(key);

    if (!entry || entry.expires < now) {
      counters.set(key, { count: 1, expires: now + 60_000 });
      next();
      return;
    }

    entry.count += 1;

    if (entry.count > maxRequests) {
      response.status(429).json({
        error: 'Too many requests. Try again shortly.',
      });
      return;
    }

    next();
  };
}

export function createApp(
  database: PrismaClient,
  manager: RunManager,
  catalog: TargetDescriptor[]
) {
  const app = express();
  const sessions = new SandboxSessions();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));

  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');

    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
    );

    if (_request.path.startsWith('/api/')) {
      response.setHeader('Cache-Control', 'no-store');
    }

    response.setHeader('X-Request-Id', randomUUID());
    next();
  });

  // Health check endpoints
  app.get('/api/v1/health/live', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/api/v1/health/ready', async (_request, response, next) => {
    try {
      await database.$queryRaw`SELECT 1`;
      response.json({ status: 'ready' });
    } catch (error) {
      next(error);
    }
  });

  // Available testing targets
  app.get('/api/v1/targets', (_request, response) => {
    response.json(catalog);
  });

  // Each request starts with a fresh sandbox state.
  app.post('/api/v1/sandbox/execute', (request, response) => {
    const parsed = traceBody.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: 'Provide targetId and an actions array (maximum 12)',
      });
      return;
    }

    const target = catalog.find(
      (candidate) =>
        candidate.id === parsed.data.targetId &&
        candidate.id !== 'external'
    );

    if (!target) {
      response.status(404).json({
        error: 'Unknown built-in target',
      });
      return;
    }

    if (
      parsed.data.actions.some(
        (action) => !target.actions.includes(action)
      )
    ) {
      response.status(400).json({
        error: `Allowed actions: ${target.actions.join(', ')}`,
      });
      return;
    }

    response.json({
      outputs: executeTrace(target.id, parsed.data.actions),
    });
  });

  // Create sandbox session
  app.post(
    '/api/v1/sandbox/sessions',
    createLocalRateLimit(30),
    (request, response) => {
      const parsed = z.object({
        targetId: z.string(),
      }).strict().safeParse(request.body);

      const target = parsed.success
        ? catalog.find(
            (item) =>
              item.id === parsed.data.targetId &&
              item.id !== 'external'
          )
        : null;

      if (!target) {
        response.status(400).json({
          error: 'Specify a valid built-in targetId',
        });
        return;
      }

      try {
        response.status(201).json({
          sessionId: sessions.create(target.id),
          targetId: target.id,
        });
      } catch {
        response.status(429).json({
          error: 'Sandbox session capacity reached',
        });
      }
    }
  );

  // Execute an action in an existing sandbox session
  app.post('/api/v1/sandbox/sessions/:id/actions', (request, response) => {
    const parsed = z.object({
      action: z.string(),
    }).strict().safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: 'Specify one action',
      });
      return;
    }

    const targetId = sessions.getTarget(request.params.id);
    const target = catalog.find((item) => item.id === targetId);

    if (!target) {
      response.status(404).json({
        error: 'Unknown or expired session',
      });
      return;
    }

    if (!target.actions.includes(parsed.data.action)) {
      response.status(400).json({
        error: 'Invalid action',
      });
      return;
    }

    const output = sessions.step(
      request.params.id,
      parsed.data.action,
      target.actions
    );

    if (output === null) {
      response.status(404).json({
        error: 'Unknown or expired session',
      });
      return;
    }

    response.json({ output });
  });

  // Delete sandbox session
  app.delete('/api/v1/sandbox/sessions/:id', (request, response) => {
    if (!sessions.delete(request.params.id)) {
      response.status(404).json({
        error: 'Unknown session',
      });
      return;
    }

    response.status(204).end();
  });

  // List experiment runs
  app.get('/api/v1/runs', async (request, response, next) => {
    const parsed = z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .safeParse(request.query.limit ?? 25);

    if (!parsed.success) {
      response.status(400).json({
        error: 'limit must be 1–50',
      });
      return;
    }

    try {
      const runs = await database.run.findMany({
        orderBy: { createdAt: 'desc' },
        take: parsed.data,
        select: {
          id: true,
          targetId: true,
          status: true,
          createdAt: true,
          completedAt: true,
          stateCount: true,
          queries: true,
          casesChecked: true,
          findingCount: true,
        },
      });

      response.json(runs);
    } catch (error) {
      next(error);
    }
  });

  // Retrieve a single experiment run
  app.get('/api/v1/runs/:id', async (request, response, next) => {
    const parsed = uuid.safeParse(request.params.id);

    if (
      !parsed.success &&
      !['demo-rate-limiter', 'demo-authentication'].includes(
        request.params.id
      )
    ) {
      response.status(400).json({
        error: 'Invalid run ID',
      });
      return;
    }

    try {
      const run = await database.run.findUnique({
        where: { id: request.params.id },
      });

      if (!run) {
        response.status(404).json({
          error: 'Run not found',
        });
        return;
      }

      response.json(run);
    } catch (error) {
      next(error);
    }
  });

  // Start a new experiment
  app.post(
    '/api/v1/runs',
    createLocalRateLimit(15),
    async (request, response, next) => {
      const parsed = bodyForRun.safeParse(request.body);

      if (!parsed.success) {
        response.status(400).json({
          error: 'Invalid run settings',
          details: parsed.error.flatten(),
        });
        return;
      }

      const target = catalog.find(
        (item) => item.id === parsed.data.targetId
      );

      if (!target) {
        response.status(404).json({
          error: 'Unknown target',
        });
        return;
      }

      const settings = parsed.data.settings ?? DEFAULTS[target.id];

      if (!settings) {
        response.status(500).json({
          error: 'Missing default target settings',
        });
        return;
      }

      try {
        validateOptions(target.actions, settings);

        const id = await manager.enqueue(target.id, settings);

        response.status(202).json({
          id,
          status: 'QUEUED',
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('queue is full')
        ) {
          response.status(429).json({
            error: error.message,
          });
          return;
        }

        next(error);
      }
    }
  );

  // Cancel an experiment
  app.post('/api/v1/runs/:id/cancel', async (request, response, next) => {
    if (!uuid.safeParse(request.params.id).success) {
      response.status(400).json({
        error: 'Invalid run ID',
      });
      return;
    }

    try {
      const result = await manager.cancel(request.params.id);

      if (result === 'not-found') {
        response.status(404).json({
          error: 'Run not found',
        });
        return;
      }

      if (result === 'not-cancellable') {
        response.status(409).json({
          error: 'Run is already finished',
        });
        return;
      }

      response.status(202).json({
        status: 'CANCELLING',
      });
    } catch (error) {
      next(error);
    }
  });

  // Delete an experiment
  app.delete('/api/v1/runs/:id', async (request, response, next) => {
    if (!uuid.safeParse(request.params.id).success) {
      response.status(400).json({
        error: 'Invalid run ID',
      });
      return;
    }

    try {
      const run = await database.run.findUnique({
        where: { id: request.params.id },
      });

      if (!run) {
        response.status(404).json({
          error: 'Run not found',
        });
        return;
      }

      if (run.status === 'QUEUED' || run.status === 'RUNNING') {
        response.status(409).json({
          error: 'Cancel the run before deleting',
        });
        return;
      }

      await database.run.delete({
        where: { id: run.id },
      });

      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // Handle unknown API endpoints
  app.use('/api', (_request, response) => {
    response.status(404).json({
      error: 'API endpoint not found',
    });
  });

  // FIX: Resolve the frontend path relative to this file.
  // The API starts from apps/api, not the repository root.
  const webDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../web/dist'
  );

  // Serve the React dashboard
  if (fs.existsSync(path.join(webDirectory, 'index.html'))) {
    app.use(express.static(webDirectory));

    // React uses client-side routing, so return index.html
    // for frontend routes that Express does not recognize.
    app.get('*', (_request, response) => {
      response.sendFile(path.join(webDirectory, 'index.html'));
    });
  }

  // Handle unknown routes
  app.use((_request, response) => {
    response.status(404).json({
      error: 'Not found',
    });
  });

  // Global error handler
  const errorHandler: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    _next
  ) => {
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({
        error: 'Malformed JSON',
      });
      return;
    }

    console.error(
      JSON.stringify({
        event: 'request_error',
        message:
          error instanceof Error
            ? error.message
            : String(error),
      })
    );

    response.status(500).json({
      error: 'Internal server error',
    });
  };

  app.use(errorHandler);

  return app;
}
