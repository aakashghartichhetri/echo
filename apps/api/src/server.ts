import { PrismaClient } from '@prisma/client';
import { config } from './config.js';
import { createCatalog } from './sandbox/catalog.js';
import { RunManager } from './service/run-manager.js';
import { createApp } from './app.js';

const database = new PrismaClient();
const catalog = createCatalog(config.ECHO_EXTERNAL_URL, config.ECHO_EXTERNAL_ACTIONS);
const manager = new RunManager(database, catalog, config.ORACLE_BASE_URL, config.ECHO_EXTERNAL_URL);

async function main() {
  await database.$connect();
  await manager.recover();
  const server = createApp(database, manager, catalog).listen(config.PORT, '0.0.0.0', () => {
    console.info(JSON.stringify({ event: 'server_ready', port: config.PORT, targets: catalog.map((target) => target.id) }));
  });
  const shutdown = async () => {
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
