/**
 * IngestionService — orchestrates the read -> chunk -> embed -> upsert pipeline
 * for a single Lark resource. Read-only toward Lark.
 */

import { createHash } from 'crypto';
import { KnowledgeStore } from './KnowledgeStore';
import { chunkText } from './chunker';
import { embed } from './embedder';
import { readDoc, readWikiSpace, readDriveFolder } from '../integrations/lark/readers';
import { DocPayload, IngestRequest, IngestResult, KnowledgeChunk } from '../types';
import { logger } from '../utils/logger';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export class IngestionService {
  constructor(private store: KnowledgeStore) {}

  async ingest(req: IngestRequest): Promise<IngestResult> {
    const { payloads, skipped } = await this.fetch(req);
    const result: IngestResult = { indexedChunks: 0, sources: [], skipped };

    for (const payload of payloads) {
      const texts = chunkText(payload.text);
      if (texts.length === 0) {
        logger.debug(`No text extracted from ${payload.sourceId}, skipping`);
        continue;
      }

      const embeddings = await embed(texts);

      const chunks: KnowledgeChunk[] = texts.map((content, i) => ({
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
        sourceUrl: payload.url,
        title: payload.title,
        chunkIndex: i,
        content,
        contentHash: sha256(content),
        embedding: embeddings[i],
        metadata: { ingestType: req.type },
      }));

      const n = await this.store.upsertChunks(payload.sourceId, chunks);
      result.indexedChunks += n;
      result.sources.push({ title: payload.title, url: payload.url, chunks: n });
    }

    logger.info(
      `Ingest complete: ${result.indexedChunks} chunks from ${result.sources.length} source(s), ${result.skipped} skipped`
    );
    return result;
  }

  private async fetch(req: IngestRequest): Promise<{ payloads: DocPayload[]; skipped: number }> {
    switch (req.type) {
      case 'doc':
        return { payloads: [await readDoc(req.token)], skipped: 0 };
      case 'wiki_space':
        return { payloads: await readWikiSpace(req.token), skipped: 0 };
      case 'drive_folder':
        return readDriveFolder(req.token);
      default:
        throw new Error(`Unsupported ingest type: ${(req as { type: string }).type}`);
    }
  }
}
