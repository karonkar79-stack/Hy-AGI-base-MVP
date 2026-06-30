/**
 * Lark persistent-connection bootstrap. Opens an outbound WebSocket via the SDK
 * (no public URL / webhook needed) and routes two event types into the
 * ConversationService:
 *   - the bot-menu click (渗透测试)            -> startConversation
 *   - im.message.receive_v1 (text messages)    -> handleTurn
 *
 * Handlers are fire-and-forget: they hand work to the service and return so the
 * dispatcher stays responsive; per-chat serialization + message_id dedupe in
 * the service make redelivery safe.
 *
 * Conversation key: both entry points are keyed on the USER's open_id, not a
 * chat_id. The bot-menu event carries only operator.operator_id.open_id (no
 * chat_id at all), so open_id is the one identifier common to a menu click and
 * the user's subsequent messages — keying on it keeps them in one conversation.
 * sendText() infers receive_id_type from the id prefix, so replying to an
 * open_id works directly.
 */

import * as lark from '@larksuiteoapi/node-sdk';
import { ConversationService, InboundTurn } from '../../chat/ConversationService';
import { logger } from '../../utils/logger';

const START_PENTEST_KEY = process.env.LARK_MENU_KEY || 'start_pentest';

function parseTextContent(raw: string | undefined): string {
  if (!raw) return '';
  try {
    const obj = JSON.parse(raw);
    return typeof obj.text === 'string' ? obj.text : '';
  } catch {
    return '';
  }
}

export function startLarkBot(service: ConversationService): void {
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  if (!appId || !appSecret) {
    logger.warn('[lark] LARK_APP_ID/LARK_APP_SECRET unset — bot not started');
    return;
  }

  const domain = process.env.LARK_DOMAIN || lark.Domain.Lark;
  const wsClient = new lark.WSClient({ appId, appSecret, domain });

  const dispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data: any) => {
      const msg = data?.message;
      // Key the conversation on the sender's open_id (the same identifier the
      // menu event provides), so a menu click and later messages share one
      // conversation. message_id is the dedupe/idempotency key.
      const openId: string | undefined = data?.sender?.sender_id?.open_id;
      const messageId: string = msg?.message_id;
      const userId: string | undefined = data?.sender?.sender_id?.user_id || openId;
      const text = parseTextContent(msg?.content);

      if (!openId || !messageId || !text) {
        logger.warn('[lark] ignoring message event (missing open_id/message_id, or non-text content)');
        return;
      }
      const turn: InboundTurn = { chatId: openId, userId, idempotencyKey: messageId, text };
      service.handleTurn(turn).catch((e: Error) => logger.error(`[lark] handleTurn failed: ${e.message}`));
    },

    // NOTE: the bot-menu event name was confirmed as 'application.bot.menu_v6'
    // against a live larksuite.com tenant. Its payload carries NO chat_id — only
    // operator.operator_id.open_id — so we key the conversation on that open_id
    // and reply to it directly (sendText infers receive_id_type from the prefix).
    'application.bot.menu_v6': async (data: any) => {
      const eventKey: string = data?.event_key;
      const openId: string | undefined = data?.operator?.operator_id?.open_id;
      const userId: string | undefined = data?.operator?.operator_id?.user_id || openId;
      if (eventKey !== START_PENTEST_KEY || !openId) {
        logger.warn(`[lark] ignoring menu event (key=${eventKey}, open_id present=${!!openId})`);
        return;
      }
      service
        .startConversation(openId, userId)
        .catch((e: Error) => logger.error(`[lark] startConversation failed: ${e.message}`));
    },
  });

  wsClient.start({ eventDispatcher: dispatcher });
  logger.info('[lark] persistent connection started; listening for messages and menu clicks');
}
