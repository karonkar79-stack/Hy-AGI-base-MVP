/**
 * KnowledgeStore — pgvector-backed persistence for ingested Lark content.
 *
 * Vectors are passed as `::vector` string literals so this does not depend on
 * a specific version of the `pgvector` JS helper API. Cosine distance (`<=>`)
 * matches the `vector_cosine_ops` index created in the migration.
 */

import { Pool } from 'pg';
import { KnowledgeChunk, KnowledgeSearchResult } from '../types';
import { logger } from '../utils/logger';

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

export class KnowledgeStore {
  private pool: Pool;

  constructor(connectionString?: string) {
    const conn = connectionString ?? process.env.DATABASE_URL;
    if (!conn) {
      throw new Error('DATABASE_URL is required for KnowledgeStore');
    }
    this.pool = new Pool({ connectionString: conn });
  }

  /**
   * Replace all chunks for a source, then insert the new set, transactionally.
   * Returns the number of chunks written.
   */
  async upsertChunks(sourceId: string, chunks: KnowledgeChunk[]): Promise<number> {
    if (chunks.length === 0) return 0;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM knowledge_chunks WHERE source_id = $1', [sourceId]);

      for (const c of chunks) {
        await client.query(
          `INSERT INTO knowledge_chunks
             (source_type, source_id, source_url, title, chunk_index, content, content_hash, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9)`,
          [
            c.sourceType,
            c.sourceId,
            c.sourceUrl,
            c.title,
            c.chunkIndex,
            c.content,
            c.contentHash,
            toVectorLiteral(c.embedding),
            JSON.stringify(c.metadata ?? {}),
          ]
        );
      }

      await client.query('COMMIT');
      return chunks.length;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('upsertChunks failed, rolled back:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Cosine-similarity search. Returns the top-k chunks with citations. */
  async search(embedding: number[], k = 6): Promise<KnowledgeSearchResult[]> {
    const res = await this.pool.query(
      `SELECT title, source_url, content, 1 - (embedding <=> $1::vector) AS score
         FROM knowledge_chunks
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      [toVectorLiteral(embedding), k]
    );

    return res.rows.map((r: any) => ({
      title: r.title,
      sourceUrl: r.source_url,
      content: r.content,
      score: Number(r.score),
    }));
  }

  async deleteBySource(sourceId: string): Promise<void> {
    await this.pool.query('DELETE FROM knowledge_chunks WHERE source_id = $1', [sourceId]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
