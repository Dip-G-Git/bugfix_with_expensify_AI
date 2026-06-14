import { createApp } from './app.js';
import { env } from './utils/env.js';
import { logger } from './utils/logger.js';
import { connectDatabase } from './db/client.js';
import { startSchedulers } from './jobs/schedulers.js';

async function main() {
  await connectDatabase();

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'Server started');
  });

  startSchedulers();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error(err, 'Fatal startup error');
  process.exit(1);
});
