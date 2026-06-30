/**
 * AWS Bedrock client for Claude, authenticated with a Bedrock API key
 * (bearer token) via the AWS_BEARER_TOKEN_BEDROCK environment variable.
 *
 * It exposes a minimal `.messages.create()` surface compatible with the subset
 * of the Anthropic SDK that BaseAgent uses, so it can be swapped in directly
 * without changing the call sites.
 *
 * Notes (AWS model card for anthropic.claude-sonnet-4-6):
 *  - 1M-token context is GA on Sonnet 4.6 — NO `anthropic_beta` header needed.
 *  - In us-east-1 the in-region model is not offered, so the US cross-region
 *    inference profile `us.anthropic.claude-sonnet-4-6` must be used.
 *  - Auth is a bearer token sent as `Authorization: Bearer <key>` (no SigV4).
 */

import { logger } from '../utils/logger';

export interface BedrockMessageParams {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}

export interface BedrockMessageResponse {
  content: { type: string; text?: string }[];
  usage: { input_tokens: number; output_tokens: number };
}

export interface MessageClient {
  messages: {
    create: (params: BedrockMessageParams) => Promise<BedrockMessageResponse>;
  };
}

/** True when a Bedrock API key (bearer token) is configured. */
export function isBedrockEnabled(): boolean {
  return !!(process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.BEDROCK_API_KEY);
}

export function createBedrockClient(): MessageClient {
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.BEDROCK_API_KEY;
  if (!token) {
    throw new Error('AWS_BEARER_TOKEN_BEDROCK (Bedrock API key) is required to use Bedrock');
  }

  const region = process.env.BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1';
  const modelId = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-6';
  const anthropicVersion = process.env.BEDROCK_ANTHROPIC_VERSION || 'bedrock-2023-05-31';
  // Optional; not needed for Sonnet 4.6 (1M context is GA). Kept for forward
  // compatibility, e.g. ANTHROPIC_BETA="context-1m-2025-08-07".
  const betas = process.env.ANTHROPIC_BETA
    ? process.env.ANTHROPIC_BETA.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(
    modelId
  )}/invoke`;

  return {
    messages: {
      async create(params: BedrockMessageParams): Promise<BedrockMessageResponse> {
        const body: Record<string, any> = {
          anthropic_version: anthropicVersion,
          max_tokens: params.max_tokens ?? 4096,
          messages: params.messages,
        };
        if (params.system) body.system = params.system;
        if (typeof params.temperature === 'number') body.temperature = params.temperature;
        if (betas) body.anthropic_beta = betas;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          logger.error(`Bedrock invoke failed (${res.status}) for ${modelId}: ${detail}`);
          // Surface .status so BaseAgent's retry/backoff logic (429/4xx) works.
          const err = new Error(
            `Bedrock error ${res.status}: ${detail || res.statusText}`
          ) as Error & { status?: number };
          err.status = res.status;
          throw err;
        }

        const data = (await res.json()) as any;
        return {
          content: Array.isArray(data?.content) ? data.content : [],
          usage: {
            input_tokens: data?.usage?.input_tokens ?? 0,
            output_tokens: data?.usage?.output_tokens ?? 0,
          },
        };
      },
    },
  };
}
