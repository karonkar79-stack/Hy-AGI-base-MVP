/**
 * Unit tests for receive_id_type inference. Lark ids are self-describing by
 * prefix, which lets sendText reply correctly whether it's handed a user's
 * open_id (menu clicks carry only that) or a chat_id (group/DM chats).
 */

import { receiveIdType } from './messaging';

describe('receiveIdType', () => {
  it('infers open_id from an ou_ prefix', () => {
    expect(receiveIdType('ou_f55edae5da5a27a90a31c50f0e9d144e')).toBe('open_id');
  });

  it('infers union_id from an on_ prefix', () => {
    expect(receiveIdType('on_c239977ba7172d907075698c8bf64292')).toBe('union_id');
  });

  it('infers chat_id from an oc_ prefix', () => {
    expect(receiveIdType('oc_1234567890abcdef')).toBe('chat_id');
  });

  it('defaults to chat_id for anything else (preserving prior behavior)', () => {
    expect(receiveIdType('something-else')).toBe('chat_id');
  });
});
