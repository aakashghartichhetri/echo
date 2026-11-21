import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { HttpTraceOracle } from '../src/engine/http-oracle.js';
import { analyze } from '../src/engine/learner.js';
import { BUILTIN_TARGETS } from '../src/sandbox/targets.js';
import { DEFAULTS } from '../src/service/defaults.js';
import type { RunManager } from '../src/service/run-manager.js';

let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; });

describe('real HTTP black-box boundary', () => {
  it('infers behavior via fetch over a real ephemeral Express server', async () => {
    const fakeDb = {} as PrismaClient;
    const fakeManager = {} as RunManager;
    server = createApp(fakeDb, fakeManager, BUILTIN_TARGETS).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    const oracle = new HttpTraceOracle(`http://127.0.0.1:${port}/api/v1/sandbox/execute`, 'rate-limiter', undefined, true);
    const report = await analyze(BUILTIN_TARGETS[0]!, oracle, DEFAULTS['rate-limiter']!);
    expect(report.machine.states).toHaveLength(4);
    expect(report.findings[0]?.observed[7]).toBe('cooldown');
  }, 15000);
});
