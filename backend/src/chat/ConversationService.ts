// src/chat/ConversationService.ts
/**
 * ConversationService — the requirement-alignment loop (design approach C).
 *
 * Per turn: dedupe -> ingest any new doc references -> CONVERSE call (reply to
 * the user) -> EXTRACT call (re-derive the whole scope) -> completeness gate.
 * The converse failure is surfaced to the user; the extract failure is
 * swallowed (the next turn re-derives). Turns are serialized per chat so two
 * concurrent messages can't clobber the same scope.
 */

import { IConversationStore, DocumentRow } from './store';
import { SourceConnector } from '../connectors/types';
import { detectReferences, findConnector, LARK_CONNECTORS } from '../connectors/registry';
import { conversePrompt, extractPrompt, buildContext, parseScopeJson } from './prompts';
import { isComplete, missingFields } from './scope';
import { MessageClient, BedrockMessageResponse } from '../llm/bedrock';
import { logger } from '../utils/logger';

export interface InboundTurn {
  chatId: string;
  userId?: string;
  idempotencyKey: string;
  text: string;
}

export interface ConversationDeps {
  store: IConversationStore;
  llm: MessageClient;
  connectors?: SourceConnector[];
  send: (chatId: string, text: string) => Promise<void>;
  operatorChatId?: string;
}

const AFFIRMATIVE_RE = /\b(yes|proceed|confirm|looks good|go ahead|对|确认|可以)\b/i;

function textOf(resp: BedrockMessageResponse): string {
  return resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
    .trim();
}

export class ConversationService {
  private readonly store: IConversationStore;
  private readonly llm: MessageClient;
  private readonly connectors: SourceConnector[];
  private readonly send: (chatId: string, text: string) => Promise<void>;
  private readonly operatorChatId?: string;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(deps: ConversationDeps) {
    this.store = deps.store;
    this.llm = deps.llm;
    this.connectors = deps.connectors ?? LARK_CONNECTORS;
    this.send = deps.send;
    this.operatorChatId = deps.operatorChatId;
  }

  /** Serialize work per chat_id so concurrent turns don't race on the scope. */
  private withChatLock<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(chatId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(fn);
    this.locks.set(
      chatId,
      next.catch(() => undefined)
    );
    return next;
  }

  /** Bot-menu click: begin a fresh conversation and greet. */
  async startConversation(chatId: string, userId?: string): Promise<void> {
    await this.withChatLock(chatId, async () => {
      await this.store.getOrCreateByChatId(chatId, userId);
      await this.send(
        chatId,
        '你好！我将帮助你定义渗透测试的范围。请描述你的需求，并可以粘贴相关的 Lark 文档链接。\n\n' +
          "Hi! I'll help scope your penetration test. Describe your requirements and paste any relevant Lark document links."
      );
    });
  }

  async handleTurn(turn: InboundTurn): Promise<void> {
    await this.withChatLock(turn.chatId, () => this.processTurn(turn));
  }

  private async processTurn(turn: InboundTurn): Promise<void> {
    // 1. Dedupe on the idempotency key (Lark message_id).
    if (await this.store.messageExists(turn.idempotencyKey)) {
      logger.debug(`[chat] duplicate message ${turn.idempotencyKey}, skipping`);
      return;
    }

    const conv = await this.store.getOrCreateByChatId(turn.chatId, turn.userId);

    // 2. Ingest any NEW document references (per-reference error handling).
    await this.ingestReferences(conv.id, turn.chatId, turn.text);

    // 3. Append the user message (also records the idempotency key).
    await this.store.appendMessage(conv.id, 'user', turn.text, turn.idempotencyKey);

    // 4. CONVERSE — produce and send the reply. Failure is surfaced.
    const docs = await this.store.getDocuments(conv.id);
    const history = await this.store.getMessages(conv.id);
    const missing = missingFields(conv.scope);

    let reply: string;
    try {
      const resp = await this.llm.messages.create({
        system: conversePrompt(missing),
        max_tokens: 1024,
        messages: [{ role: 'user', content: buildContext(docs, history) }],
      });
      reply = textOf(resp) || 'Could you tell me a bit more about the scope?';
    } catch (err: any) {
      logger.error(`[chat] converse call failed: ${err.message}`);
      await this.send(
        turn.chatId,
        "I hit a problem thinking that through. Please say 'continue' and I'll try again."
      );
      return; // do NOT advance state
    }

    await this.store.appendMessage(conv.id, 'assistant', reply);
    try {
      await this.send(turn.chatId, reply);
    } catch (err: any) {
      logger.warn(`[chat] failed to send reply (recoverable next turn): ${err.message}`);
    }

    // 5. EXTRACT — re-derive the whole scope. Failure is swallowed (self-heals).
    const historyWithReply = await this.store.getMessages(conv.id);
    try {
      const resp = await this.llm.messages.create({
        system: extractPrompt(),
        max_tokens: 1024,
        messages: [{ role: 'user', content: buildContext(docs, historyWithReply) }],
      });
      const scope = parseScopeJson(textOf(resp));
      await this.store.updateScope(conv.id, scope);
      conv.scope = scope;
    } catch (err: any) {
      logger.warn(`[chat] extract call failed (will re-derive next turn): ${err.message}`);
    }

    // 6. Gate: confirmation only hands off when the scope is actually complete.
    if (isComplete(conv.scope) && AFFIRMATIVE_RE.test(turn.text)) {
      await this.handoff(conv.id, turn.chatId);
    }
  }

  private async ingestReferences(conversationId: string, chatId: string, text: string): Promise<void> {
    const detected = detectReferences(text, this.connectors);
    if (detected.length === 0) return;

    const existing = await this.store.getDocuments(conversationId);
    const known = new Set(existing.map((d) => d.sourceRef));

    for (const { connectorType, ref } of detected) {
      if (known.has(ref)) continue;
      known.add(ref);
      const connector = findConnector(connectorType, this.connectors);
      if (!connector) continue;

      try {
        const payloads = await connector.fetch(ref);
        for (const p of payloads) {
          const doc: Omit<DocumentRow, 'id' | 'createdAt'> = {
            conversationId,
            connectorType,
            sourceRef: ref,
            title: p.title,
            sourceUrl: p.url,
            content: p.text,
            status: 'ingested',
            error: null,
          };
          await this.store.addDocument(doc);
        }
        logger.info(`[chat] ingested ${payloads.length} doc(s) from ${ref}`);
      } catch (err: any) {
        await this.store.addDocument({
          conversationId,
          connectorType,
          sourceRef: ref,
          title: null,
          sourceUrl: ref,
          content: null,
          status: 'failed',
          error: err.message,
        });
        await this.send(
          chatId,
          `I couldn't read ${ref} — ${err.message}. Please check the link or share it with the bot, then resend.`
        );
      }
    }
  }

  private async handoff(conversationId: string, chatId: string): Promise<void> {
    await this.store.setStatus(conversationId, 'READY_FOR_REVIEW');
    await this.send(
      chatId,
      '✅ Thanks! Your scope is complete and has been sent to our operator for review. We will follow up shortly.'
    );

    if (!this.operatorChatId) {
      logger.warn('[chat] OPERATOR_CHAT_ID unset — handoff notification skipped');
      return;
    }
    const conv = await this.store.getByChatId(chatId);
    await this.send(
      this.operatorChatId,
      `🔔 New pentest scope ready for review (conversation ${conversationId}).\n` +
        `Scope: ${JSON.stringify(conv?.scope ?? {}, null, 2)}`
    );
  }
}
