import { PrismaClient } from '@prisma/client';
import { config } from './config.js';
import { createCatalog } from './sandbox/catalog.js';
import { RunManager } from './service/run-manager.js';
import { createApp } from './app.js';

const database = new PrismaClient();
const catalog = createCatalog(config.ECHO_EXTERNAL_URL, config.ECHO_EXTERNAL_ACTIONS);
const manager = new RunManager(database, catalog, config.ORACLE_BASE_URL, config.ECHO_EXTERNAL_URL,
  config.INTERNAL_ORACLE_SECRET ?? 'local-internal-oracle', config.DAILY_RUN_LIMIT);

async function main() {
  await database.$connect();
  await manager.recover();
  await database.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  // Expired session records are harmless but should not pile up on a long-lived host.
  const cleanup = setInterval(() => {
    void database.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => console.error(JSON.stringify({ event: 'session_cleanup_failed' })));
  }, 60 * 60 * 1000);
  cleanup.unref();
  const server = createApp(database, manager, catalog, config.ECHO_RATE_LIMITER_MODE).listen(config.PORT, '0.0.0.0', () => {
    console.info(JSON.stringify({ event: 'server_ready', port: config.PORT, targets: catalog.map((target) => target.id) }));
  });
  const shutdown = async () => {
    clearInterval(cleanup);
    await manager.shutdown();
    server.close(async () => { await database.$disconnect(); process.exit(0); });
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}

main().catch(async (error: unknown) => {
  console.error('Failed to start ECHO:', error);
  await database.$disconnect();
  process.exitCode = 1;
});
