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

function isBlock(v: any): boolean {
  return !!v && typeof v === 'object' && (Array.isArray(v.content) || typeof v.title === 'string');
}

function flattenPost(post: any): string {
  // Received posts come in two shapes: language-wrapped
  // ({en_us|zh_cn:{title,content}}) or unwrapped ({title,content}) directly.
  // Pick the block accordingly — never grab a bare string (e.g. a title) as the
  // block, which would silently yield empty text.
  let block: any;
  if (isBlock(post)) {
    block = post; // unwrapped: {title, content}
  } else if (isBlock(post?.en_us)) {
    block = post.en_us;
  } else if (isBlock(post?.zh_cn)) {
    block = post.zh_cn;
  } else if (post && typeof post === 'object') {
    block = Object.values(post).find(isBlock);
  }
  if (!isBlock(block)) return '';

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
