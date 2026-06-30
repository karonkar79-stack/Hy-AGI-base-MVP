/**
 * Outbound Lark messaging. Sends a plain-text message via the im.message.create
 * OpenAPI (text message_type expects a JSON-stringified { text } content body).
 *
 * The receive_id_type is inferred from the id's prefix, because the two entry
 * points hand us different id kinds: a bot-menu click carries only the user's
 * open_id (no chat_id), while a chat message carries a chat_id. Lark ids are
 * self-describing — ou_ = open_id, on_ = union_id, everything else (oc_, …) is
 * treated as a chat_id.
 */

import { getLarkClient } from './LarkClient';
import { logger } from '../../utils/logger';

export type ReceiveIdType = 'open_id' | 'union_id' | 'chat_id';

export function receiveIdType(id: string): ReceiveIdType {
  if (id.startsWith('ou_')) return 'open_id';
  if (id.startsWith('on_')) return 'union_id';
  return 'chat_id';
}

export async function sendText(receiveId: string, text: string): Promise<void> {
  const client = getLarkClient();
  await client.im.message.create({
    params: { receive_id_type: receiveIdType(receiveId) },
    data: {
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
  });
  logger.debug(`[lark] sent message to ${receiveId} (${text.length} chars)`);
}
