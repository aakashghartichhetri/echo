import { Prisma, PrismaClient } from '@prisma/client';
import { analyze } from '../src/engine/learner.js';
import { BUILTIN_TARGETS, executeTrace } from '../src/sandbox/targets.js';
import { DEFAULTS } from '../src/service/defaults.js';

const database = new PrismaClient();

async function seed() {
  // Public workspaces start empty; demo reports remain local-only.
  if (process.env.AUTH_MODE === 'github') return;
  for (const target of BUILTIN_TARGETS) {
    const id = `demo-${target.id}`;
    if (await database.run.findUnique({ where: { id } })) continue;
    const settings = DEFAULTS[target.id];
    if (!settings) throw new Error('Missing seed settings');
    // Seed samples always show the reference implementation. Live runs use HTTP.
    const report = await analyze(target, { trace: async (actions) => executeTrace(target.id, actions) }, settings);
    await database.run.create({
      data: {
        id,
        userId: 'local-demo',
        targetId: target.id,
        status: 'COMPLETED',
        settings: settings as unknown as Prisma.InputJsonValue,
        report: report as unknown as Prisma.InputJsonValue,
        queries: report.uniqueQueries,
        casesChecked: report.checkedTraces,
        stateCount: report.machine.states.length,
        findingCount: report.findings.length,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });
    console.info(`Seeded ${target.name} sample run`);
  }
}

seed().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(async () => { await database.$disconnect(); });
