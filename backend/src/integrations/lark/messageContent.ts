/**
 * Extract readable plain text from a Lark message's `content` (a JSON string),
 * by msg_type:
 *   - `text` → { text: "..." }
 *   - `post` (rich text: lists, @mentions, links, formatting) →
 *       { zh_cn|en_us: { title, content: [[{tag, text|user_name|...}]] } }
 *     We flatten the title + every paragraph's nodes into one string, pulling
 *     `text` from text/a/md/code_block nodes and the display name from `at`
 *     mentions. Other msg_types (image, file, …) have no text → "".
 *
 * The alignment loop only needs the words the user typed, so structure is
 * discarded and nodes are space/newline-joined.
 */

interface PostNode {
  tag: string;
  text?: string;
  user_name?: string;
}

function flattenPost(post: any): string {
  // Prefer whichever language block is present (en_us or zh_cn or any first key).
  const block =
    post?.en_us ?? post?.zh_cn ?? (post && typeof post === 'object' ? Object.values(post)[0] : undefined);
  if (!block || typeof block !== 'object') return '';

  const parts: string[] = [];
  if (typeof block.title === 'string' && block.title.trim()) parts.push(block.title.trim());

  const paragraphs: PostNode[][] = Array.isArray(block.content) ? block.content : [];
  for (const para of paragraphs) {
    if (!Array.isArray(para)) continue;
    const line = para
      .map((node) => {
        if (!node || typeof node !== 'object') return '';
        if (typeof node.text === 'string') return node.text; // text, a, md, code_block
        if (node.tag === 'at' && typeof node.user_name === 'string') return node.user_name;
        return '';
      })
      .join('')
      .trim();
    if (line) parts.push(line);
  }

  return parts.join('\n').trim();
}

export function extractText(msgType: string | undefined, raw: string | undefined): string {
  if (!raw) return '';
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return '';
  }

  if (msgType === 'post') return flattenPost(obj);
  // Default to the plain-text shape (covers msg_type 'text'; harmless otherwise).
  return typeof obj?.text === 'string' ? obj.text : '';
}
