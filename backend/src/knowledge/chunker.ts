/**
 * Splits extracted document text into overlapping chunks on paragraph
 * boundaries. Sizes are approximate (token ~= 4 chars), which is sufficient
 * for retrieval without pulling in a tokenizer dependency.
 */

const CHARS_PER_TOKEN = 4;

export interface ChunkOptions {
  maxTokens?: number;
  overlapTokens?: number;
}

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const maxChars = (opts.maxTokens ?? 800) * CHARS_PER_TOKEN;
  const overlapChars = (opts.overlapTokens ?? 100) * CHARS_PER_TOKEN;
  const step = Math.max(1, maxChars - overlapChars);

  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  const pushCurrent = (): void => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
  };

  for (const para of paragraphs) {
    // A single paragraph larger than the window is hard-split with overlap.
    if (para.length > maxChars) {
      pushCurrent();
      current = '';
      for (let i = 0; i < para.length; i += step) {
        chunks.push(para.slice(i, i + maxChars));
      }
      continue;
    }

    if (current.length + para.length + 2 > maxChars) {
      pushCurrent();
      const tail = current.slice(Math.max(0, current.length - overlapChars));
      current = tail ? `${tail}\n\n${para}` : para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  pushCurrent();

  return chunks;
}
