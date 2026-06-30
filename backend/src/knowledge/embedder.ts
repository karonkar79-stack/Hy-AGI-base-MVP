/**
 * OpenAI embeddings wrapper. The client is created lazily so the server can
 * boot without OPENAI_API_KEY (the key is only needed at ingest/search time).
 */

import OpenAI from 'openai';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for embeddings');
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

const BATCH_SIZE = 96;

/** Embed an array of texts, batching to stay within request limits. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const openai = getClient();
  const model = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await openai.embeddings.create({ model, input: batch });
    for (const item of res.data) {
      out.push(item.embedding);
    }
  }

  return out;
}

/** Convenience helper for a single string (e.g. a search query). */
export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  return vec;
}
