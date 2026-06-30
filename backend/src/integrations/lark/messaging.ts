/**
 * Outbound Lark messaging. Sends a plain-text message to a chat via the
 * im.message.create OpenAPI (text message_type expects a JSON-stringified
 * { text } content body).
 */

import { getLarkClient } from './LarkClient';
import { logger } from '../../utils/logger';

export async function sendText(chatId: string, text: string): Promise<void> {
  const client = getLarkClient();
  await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
  });
  logger.debug(`[lark] sent message to ${chatId} (${text.length} chars)`);
}
