/**
 * Tests for extracting plain text from Lark message content.
 *
 * Lark sends different content shapes by msg_type: a plain `text` message is
 * { text: "..." }, while a rich-text `post` message (numbered/bulleted lists,
 * @mentions, formatting) is { zh_cn|en_us: { title, content: [[{tag,...}]] } }.
 * The bot's alignment loop only needs the readable text, flattened.
 */

import { extractText } from './messageContent';

describe('extractText', () => {
  it('extracts a plain text message', () => {
    expect(extractText('text', JSON.stringify({ text: 'hello there' }))).toBe('hello there');
  });

  it('flattens a post message: paragraphs, text/link nodes, and @mentions', () => {
    const post = {
      en_us: {
        title: 'My reply',
        content: [
          [
            { tag: 'text', text: '1. 1 of July' },
          ],
          [
            { tag: 'text', text: '4. ' },
            { tag: 'at', user_id: 'ou_x', user_name: 'Jason Jei' },
          ],
          [
            { tag: 'a', text: 'the doc', href: 'https://x' },
          ],
        ],
      },
    };
    const out = extractText('post', JSON.stringify(post));
    expect(out).toContain('My reply');
    expect(out).toContain('1. 1 of July');
    expect(out).toContain('Jason Jei'); // @mention rendered as the display name
    expect(out).toContain('the doc'); // link text
  });

  it('handles a post wrapped under zh_cn', () => {
    const post = { zh_cn: { title: '', content: [[{ tag: 'text', text: '可以' }]] } };
    expect(extractText('post', JSON.stringify(post))).toContain('可以');
  });

  it('returns empty string for unparseable or unsupported content', () => {
    expect(extractText('text', undefined)).toBe('');
    expect(extractText('text', 'not json')).toBe('');
    expect(extractText('image', JSON.stringify({ image_key: 'k' }))).toBe('');
  });
});
