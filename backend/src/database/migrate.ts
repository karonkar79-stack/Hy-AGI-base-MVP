/**
 * Database migration runner.
 *
 * Sets up the pgvector-backed knowledge base schema (see
 * docs/LARK_KNOWLEDGE_BASE.md). The statements are idempotent, so the script
 * is safe to run repeatedly.
 *
 * If DATABASE_URL is not set, the migration is skipped so the in-memory MVP
 * paths keep working without a database.
 */

import { config } from 'dotenv';
import path from 'path';
import { Pool } from 'pg';
import { logger } from '../utils/logger';

// Load backend/.env if present, then fall back to the repo-root .env (where
// docker-compose and .env.example also live). dotenv does not override vars
// that are already set, so the first definition wins.
config();
config({ path: path.resolve(process.cwd(), '../.env') });

const EMBED_DIM = Number(process.env.KB_EMBED_DIM ?? 1536);

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type   TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  source_url    TEXT,
  title         TEXT,
  chunk_index   INT  NOT NULL,
  content       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  embedding     VECTOR(${EMBED_DIM}) NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}',
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx
  ON knowledge_chunks (source_type, source_id);

CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     TEXT NOT NULL,
  user_id     TEXT,
  status      TEXT NOT NULL DEFAULT 'ACTIVE',
  scope       JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_chat_idx ON conversations (chat_id);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  event_id        TEXT,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS conversation_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  connector_type  TEXT NOT NULL,
  source_ref      TEXT NOT NULL,
  title           TEXT,
  source_url      TEXT,
  content         TEXT,
  status          TEXT NOT NULL,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_documents_conv_idx ON conversation_documents (conversation_id);
`;

async function migrate(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.warn('DATABASE_URL not set — skipping migration (in-memory mode).');
    return;
  }

  const pool = new Pool({ connectionString });
  try {
    logger.info(`Running knowledge_chunks migration (embedding dim=${EMBED_DIM})...`);
    await pool.query(SCHEMA_SQL);
    logger.info('Migration complete.');
  } finally {
    await pool.end();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Migration failed:', error);
    process.exit(1);
  });
