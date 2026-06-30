/**
 * AWS Bedrock embeddings wrapper (Amazon Titan Text Embeddings).
 *
 * Calls the Bedrock Runtime REST API directly using a Bedrock API key
 * (`AWS_BEARER_TOKEN_BEDROCK`) as a bearer token, so no AWS SDK / SigV4 signing
 * is needed. Configuration is read lazily so the server can boot without
 * Bedrock env — the credentials are only required at ingest/search time.
 *
 * Titan embeds a single text per request (no batch input), so `embed` issues
 * one call per chunk. The output dimension must match `KB_EMBED_DIM` and the
 * pgvector column created by the migration.
 */

import { logger } from '../utils/logger';

interface BedrockConfig {
  region: string;
  token: string;
  modelId: string;
  dimensions: number;
}

function getConfig(): BedrockConfig {
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!token) {
    throw new Error('AWS_BEARER_TOKEN_BEDROCK is required for embeddings');
  }
  const region = process.env.BEDROCK_REGION || 'us-east-1';
  const modelId = process.env.BEDROCK_EMBED_MODEL_ID || 'amazon.titan-embed-text-v2:0';
  const dimensions = Number(process.env.KB_EMBED_DIM ?? 1024);
  return { region, token, modelId, dimensions };
}

/** Embed a single text via Bedrock Titan. */
async function embedText(text: string, cfg: BedrockConfig): Promise<number[]> {
  const url = `https://bedrock-runtime.${cfg.region}.amazonaws.com/model/${encodeURIComponent(
    cfg.modelId
  )}/invoke`;

  // Titan V2 honors `dimensions` + `normalize`; V1 ignores them harmlessly.
  const body = JSON.stringify({ inputText: text, dimensions: cfg.dimensions, normalize: true });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Bedrock embeddings failed (HTTP ${res.status}) for model ${cfg.modelId} — ${detail}`);
  }

  const data: any = await res.json();
  const embedding: number[] | undefined = data?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error(`Bedrock embeddings returned no vector for model ${cfg.modelId}`);
  }
  if (embedding.length !== cfg.dimensions) {
    logger.warn(
      `Bedrock embedding dim ${embedding.length} != KB_EMBED_DIM ${cfg.dimensions}; check model/migration alignment`
    );
  }
  return embedding;
}

/** Embed an array of texts (one Bedrock call per text). */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const cfg = getConfig();
  const out: number[][] = [];
  for (const text of texts) {
    out.push(await embedText(text, cfg));
  }
  return out;
}

/** Convenience helper for a single string (e.g. a search query). */
export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  return vec;
}
