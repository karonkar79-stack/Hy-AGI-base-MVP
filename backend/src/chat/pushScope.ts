/**
 * One-off: push an already-completed pentest scope to the operator group.
 *
 *   npm run push-scope -- <chatId>            # push the latest conversation for a user/chat
 *   npm run push-scope -- --id <conversationId>
 *
 * With no argument it pushes the single most-recently-updated READY_FOR_REVIEW
 * conversation. Renders through formatScopeForOperator (same as the live
 * handoff) and sends to OPERATOR_CHAT_ID via the existing Lark client.
 *
 * This is a manual utility for verifying group delivery / re-sending a scope
 * without running a fresh conversation — not part of the request flow.
 */

import { config } from 'dotenv';
import path from 'path';
import { Pool } from 'pg';
import { PentestScope, emptyScope } from './scope';
import { formatScopeForOperator } from './scopeFormat';
import { sendText } from '../integrations/lark/messaging';
import { logger } from '../utils/logger';

// Match index.ts env loading: backend/.env then repo-root .env (first wins).
config();
config({ path: path.resolve(process.cwd(), '../.env') });

interface Target {
  id: string;
  scope: PentestScope;
}

async function resolveTarget(pool: Pool, argv: string[]): Promise<Target | null> {
  const idFlag = argv.indexOf('--id');
  if (idFlag !== -1 && argv[idFlag + 1]) {
    const res = await pool.query(`SELECT id, scope FROM conversations WHERE id = $1`, [
      argv[idFlag + 1],
    ]);
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  const chatId = argv.find((a) => !a.startsWith('--'));
  if (chatId) {
    const res = await pool.query(
      `SELECT id, scope FROM conversations WHERE chat_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [chatId]
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  // Default: the single most-recent scope ready for review.
  const res = await pool.query(
    `SELECT id, scope FROM conversations WHERE status = 'READY_FOR_REVIEW'
     ORDER BY updated_at DESC LIMIT 1`
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

function mapRow(r: any): Target {
  const scope = r.scope && Object.keys(r.scope).length ? (r.scope as PentestScope) : emptyScope();
  return { id: r.id, scope };
}

async function main(): Promise<void> {
  const operatorChatId = process.env.OPERATOR_CHAT_ID;
  if (!operatorChatId) {
    throw new Error('OPERATOR_CHAT_ID is not set — set it in .env before pushing.');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const target = await resolveTarget(pool, process.argv.slice(2));
    if (!target) {
      throw new Error('No matching conversation found to push.');
    }
    const text = formatScopeForOperator(target.id, target.scope);
    logger.info(`[push-scope] sending conversation ${target.id} to ${operatorChatId}`);
    await sendText(operatorChatId, text);
    logger.info('[push-scope] sent.');
  } finally {
    await pool.end();
  }
}

main().catch((err: Error) => {
  logger.error(`[push-scope] failed: ${err.message}`);
  process.exit(1);
});
