/**
 * Database migration runner.
 *
 * NOTE: The MVP uses in-memory storage (see MemoryManager / MessageBus), so
 * there are currently no migrations to run. This stub exists so `npm run
 * migrate` succeeds and gives team members a clear place to add real schema
 * setup once PostgreSQL/pgvector is wired up (see docs/ARCHITECTURE.md).
 */

import { logger } from '../utils/logger';

async function migrate(): Promise<void> {
  logger.info('No migrations to run — MVP uses in-memory storage.');
  logger.info('Add PostgreSQL/pgvector schema setup here when persistence is implemented.');
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Migration failed:', error);
    process.exit(1);
  });
