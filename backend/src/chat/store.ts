/**
 * ConversationStore — Postgres persistence for the alignment chatbot.
 *
 * Mirrors KnowledgeStore: a pg Pool built from DATABASE_URL, transactional
 * multi-row writes. The engine depends on IConversationStore so unit tests can
 * substitute an in-memory fake without a database.
 */

import { Pool } from 'pg';
import { PentestScope, emptyScope } from './scope';

export interface ConversationRow {
  id: string;
  chatId: string;
  userId: string | null;
  status: 'ACTIVE' | 'READY_FOR_REVIEW';
  scope: PentestScope;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  eventId: string | null;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface DocumentRow {
  id: string;
  conversationId: string;
  connectorType: string;
  sourceRef: string;
  title: string | null;
  sourceUrl: string | null;
  content: string | null;
  status: 'ingested' | 'failed';
  error: string | null;
  createdAt: string;
}

export interface IConversationStore {
  getOrCreateByChatId(chatId: string, userId?: string): Promise<ConversationRow>;
  getByChatId(chatId: string): Promise<ConversationRow | null>;
  messageExists(idempotencyKey: string): Promise<boolean>;
  appendMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    idempotencyKey?: string
  ): Promise<MessageRow>;
  getMessages(conversationId: string): Promise<MessageRow[]>;
  addDocument(doc: Omit<DocumentRow, 'id' | 'createdAt'>): Promise<DocumentRow>;
  getDocuments(conversationId: string): Promise<DocumentRow[]>;
  updateScope(conversationId: string, scope: PentestScope): Promise<void>;
  setStatus(conversationId: string, status: ConversationRow['status']): Promise<void>;
}

function mapConversation(r: any): ConversationRow {
  return {
    id: r.id,
    chatId: r.chat_id,
    userId: r.user_id ?? null,
    status: r.status,
    // scope JSONB may be '{}' for fresh rows — fall back to a full empty scope.
    scope: r.scope && Object.keys(r.scope).length ? (r.scope as PentestScope) : emptyScope(),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapMessage(r: any): MessageRow {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    eventId: r.event_id ?? null,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  };
}

function mapDocument(r: any): DocumentRow {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    connectorType: r.connector_type,
    sourceRef: r.source_ref,
    title: r.title ?? null,
    sourceUrl: r.source_url ?? null,
    content: r.content ?? null,
    status: r.status,
    error: r.error ?? null,
    createdAt: r.created_at,
  };
}

export class ConversationStore implements IConversationStore {
  private pool: Pool;

  constructor(connectionString?: string) {
    const conn = connectionString ?? process.env.DATABASE_URL;
    if (!conn) {
      throw new Error('DATABASE_URL is required for ConversationStore');
    }
    this.pool = new Pool({ connectionString: conn });
  }

  async getOrCreateByChatId(chatId: string, userId?: string): Promise<ConversationRow> {
    const existing = await this.getByChatId(chatId);
    if (existing) return existing;
    const res = await this.pool.query(
      `INSERT INTO conversations (chat_id, user_id, scope)
       VALUES ($1, $2, $3) RETURNING *`,
      [chatId, userId ?? null, JSON.stringify(emptyScope())]
    );
    return mapConversation(res.rows[0]);
  }

  async getByChatId(chatId: string): Promise<ConversationRow | null> {
    const res = await this.pool.query(
      `SELECT * FROM conversations WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [chatId]
    );
    return res.rows[0] ? mapConversation(res.rows[0]) : null;
  }

  async messageExists(idempotencyKey: string): Promise<boolean> {
    const res = await this.pool.query(`SELECT 1 FROM messages WHERE event_id = $1 LIMIT 1`, [
      idempotencyKey,
    ]);
    return (res.rowCount ?? 0) > 0;
  }

  async appendMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    idempotencyKey?: string
  ): Promise<MessageRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `INSERT INTO messages (conversation_id, event_id, role, content)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [conversationId, idempotencyKey ?? null, role, content]
      );
      await client.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [
        conversationId,
      ]);
      await client.query('COMMIT');
      return mapMessage(res.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getMessages(conversationId: string): Promise<MessageRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId]
    );
    return res.rows.map(mapMessage);
  }

  async addDocument(doc: Omit<DocumentRow, 'id' | 'createdAt'>): Promise<DocumentRow> {
    const res = await this.pool.query(
      `INSERT INTO conversation_documents
         (conversation_id, connector_type, source_ref, title, source_url, content, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        doc.conversationId,
        doc.connectorType,
        doc.sourceRef,
        doc.title,
        doc.sourceUrl,
        doc.content,
        doc.status,
        doc.error,
      ]
    );
    return mapDocument(res.rows[0]);
  }

  async getDocuments(conversationId: string): Promise<DocumentRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM conversation_documents WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId]
    );
    return res.rows.map(mapDocument);
  }

  async updateScope(conversationId: string, scope: PentestScope): Promise<void> {
    await this.pool.query(
      `UPDATE conversations SET scope = $2, updated_at = now() WHERE id = $1`,
      [conversationId, JSON.stringify(scope)]
    );
  }

  async setStatus(conversationId: string, status: ConversationRow['status']): Promise<void> {
    await this.pool.query(
      `UPDATE conversations SET status = $2, updated_at = now() WHERE id = $1`,
      [conversationId, status]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
