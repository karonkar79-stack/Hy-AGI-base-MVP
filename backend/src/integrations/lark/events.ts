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
 * NOTE: confirm the exact bot-menu event name and the menu item's event_key in
 * the Lark/Feishu console (candidate event: 'application.bot.menu_v6'). Adjust
 * MENU_EVENT / START_PENTEST_KEY below to match what the console shows.
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
      const chatId: string = msg?.chat_id;
      const messageId: string = msg?.message_id;
      const userId: string | undefined =
        data?.sender?.sender_id?.user_id || data?.sender?.sender_id?.open_id;
      const text = parseTextContent(msg?.content);

      if (!chatId || !messageId || !text) {
        logger.debug('[lark] ignoring non-text or malformed message event');
        return;
      }
      const turn: InboundTurn = { chatId, userId, idempotencyKey: messageId, text };
      service.handleTurn(turn).catch((e: Error) => logger.error(`[lark] handleTurn failed: ${e.message}`));
    },

    'application.bot.menu_v6': async (data: any) => {
      const eventKey: string = data?.event_key;
      const chatId: string | undefined = data?.chat_id || data?.open_id;
      const userId: string | undefined =
        data?.operator?.operator_id?.user_id || data?.operator?.operator_id?.open_id;
      if (eventKey !== START_PENTEST_KEY || !chatId) {
        logger.debug(`[lark] ignoring menu event (key=${eventKey})`);
        return;
      }
      service
        .startConversation(chatId, userId)
        .catch((e: Error) => logger.error(`[lark] startConversation failed: ${e.message}`));
    },
  });

  wsClient.start({ eventDispatcher: dispatcher });
  logger.info('[lark] persistent connection started; listening for messages and menu clicks');
}
