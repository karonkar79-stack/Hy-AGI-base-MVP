// src/chat/ConversationService.test.ts
import { ConversationService, InboundTurn } from './ConversationService';
import { IConversationStore, ConversationRow, MessageRow, DocumentRow } from './store';
import { PentestScope, emptyScope, isComplete } from './scope';
import { SourceConnector } from '../connectors/types';
import { MessageClient } from '../llm/bedrock';

// ---- Fakes ----
function makeStore(): IConversationStore & { _conv: ConversationRow; _msgs: MessageRow[]; _docs: DocumentRow[] } {
  const conv: ConversationRow = {
    id: 'c1', chatId: 'chat-1', userId: null, status: 'ACTIVE',
    scope: emptyScope(), createdAt: '1', updatedAt: '1',
  };
  const msgs: MessageRow[] = [];
  const docs: DocumentRow[] = [];
  const seen = new Set<string>();
  return {
    _conv: conv, _msgs: msgs, _docs: docs,
    async getOrCreateByChatId() { return conv; },
    async getByChatId() { return conv; },
    async messageExists(k) { return seen.has(k); },
    async appendMessage(_id, role, content, key) {
      if (key) seen.add(key);
      const m: MessageRow = { id: `m${msgs.length}`, conversationId: 'c1', eventId: key ?? null, role, content, createdAt: String(msgs.length) };
      msgs.push(m); return m;
    },
    async getMessages() { return msgs; },
    async addDocument(d) {
      const row: DocumentRow = { ...d, id: `d${docs.length}`, createdAt: String(docs.length) };
      docs.push(row); return row;
    },
    async getDocuments() { return docs; },
    async updateScope(_id, scope) { conv.scope = scope; },
    async setStatus(_id, status) { conv.status = status; },
  };
}

function makeLlm(converseText: string, extractScope: Partial<PentestScope>): MessageClient & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    messages: {
      async create(params: any) {
        calls.push(params);
        // Distinguish the two calls by their system prompt (reply-first: converse then extract).
        const isExtract = params.system?.includes('extract a structured pentest scope');
        const text = isExtract ? JSON.stringify({ ...emptyScope(), ...extractScope }) : converseText;
        return { content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } };
      },
    },
  };
}

const fakeDocConnector: SourceConnector = {
  type: 'lark_doc',
  matches: (ref) => ref.includes('/docx/'),
  extractToken: () => 'tok',
  async fetch(ref) {
    if (ref.includes('boom')) throw new Error('Lark code 403: permission denied');
    return [{ sourceType: 'doc', sourceId: 'tok', title: 'Reqs', url: ref, text: 'Test the staging billing API.' }];
  },
};

function turn(text: string, key = `k-${Math.round(text.length)}-${text}`): InboundTurn {
  return { chatId: 'chat-1', userId: 'u1', idempotencyKey: key, text };
}

describe('ConversationService.handleTurn', () => {
  it('replies, persists the user + assistant messages, and re-derives scope', async () => {
    const store = makeStore();
    const send = jest.fn(async (_chatId: string, _text: string) => {});
    const llm = makeLlm('What environment is this?', { environment: 'staging' });
    const svc = new ConversationService({ store, llm, connectors: [fakeDocConnector], send });

    await svc.handleTurn(turn('hello'));

    expect(send).toHaveBeenCalledWith('chat-1', 'What environment is this?');
    expect(store._msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(store._conv.scope.environment).toBe('staging');
    // Two LLM calls: converse then extract.
    expect(llm.calls.length).toBe(2);
  });

  it('ingests a new document reference and stores its text', async () => {
    const store = makeStore();
    const send = jest.fn(async (_chatId: string, _text: string) => {});
    const llm = makeLlm('Thanks, reading that now.', {});
    const svc = new ConversationService({ store, llm, connectors: [fakeDocConnector], send });

    await svc.handleTurn(turn('here https://acme.larksuite.com/docx/Abc'));

    const ingested = store._docs.find((d) => d.status === 'ingested');
    expect(ingested?.content).toContain('staging billing API');
  });

  it('reports a per-reference fetch error in chat and records it as failed', async () => {
    const store = makeStore();
    const send = jest.fn(async (_chatId: string, _text: string) => {});
    const llm = makeLlm('ok', {});
    const svc = new ConversationService({ store, llm, connectors: [fakeDocConnector], send });

    await svc.handleTurn(turn('read https://acme.larksuite.com/docx/boom'));

    const failed = store._docs.find((d) => d.status === 'failed');
    expect(failed?.error).toMatch(/permission denied/);
    expect(send.mock.calls.some(([, msg]) => /couldn.t read|permission/i.test(msg))).toBe(true);
  });

  it('is a no-op for a duplicate idempotency key', async () => {
    const store = makeStore();
    const send = jest.fn(async (_chatId: string, _text: string) => {});
    const llm = makeLlm('hi', {});
    const svc = new ConversationService({ store, llm, connectors: [fakeDocConnector], send });

    await svc.handleTurn(turn('first', 'dup-key'));
    const calls1 = llm.calls.length;
    await svc.handleTurn(turn('again', 'dup-key'));
    expect(llm.calls.length).toBe(calls1); // no new LLM work
  });

  it('on confirmation with a complete scope, flips to READY_FOR_REVIEW and notifies operator', async () => {
    const store = makeStore();
    // Pre-fill a complete scope.
    const full: PentestScope = {
      targets: ['app.example.com'], inScope: 'web app', environment: 'staging',
      rulesOfEngagement: 'no DoS', timingWindow: 'next week', testType: 'web',
      contacts: 'ops@example.com',
    };
    store._conv.scope = full;
    expect(isComplete(full)).toBe(true);
    const send = jest.fn(async (_chatId: string, _text: string) => {});
    const llm = makeLlm('Great, handing off.', full);
    const svc = new ConversationService({ store, llm, connectors: [fakeDocConnector], send, operatorChatId: 'op-chat' });

    await svc.handleTurn(turn('Yes, please proceed'));

    expect(store._conv.status).toBe('READY_FOR_REVIEW');
    expect(send.mock.calls.some(([chat]) => chat === 'op-chat')).toBe(true);
  });

  it('when a sendCard transport is provided, the operator gets a card (not a text dump)', async () => {
    const store = makeStore();
    const full: PentestScope = {
      targets: ['app.example.com'], inScope: 'web app', environment: 'staging',
      rulesOfEngagement: 'no DoS', timingWindow: 'next week', testType: 'web',
      contacts: 'ops@example.com',
    };
    store._conv.scope = full;
    const send = jest.fn(async (_chatId: string, _text: string) => {});
    const sendCard = jest.fn(async (_chatId: string, _card: unknown) => {});
    const llm = makeLlm('Great, handing off.', full);
    const svc = new ConversationService({ store, llm, connectors: [fakeDocConnector], send, sendCard, operatorChatId: 'op-chat' });

    await svc.handleTurn(turn('Yes, please proceed'));

    // Operator notified via the card transport, with a card object — not via text.
    expect(sendCard).toHaveBeenCalledTimes(1);
    expect(sendCard.mock.calls[0][0]).toBe('op-chat');
    expect(sendCard.mock.calls[0][1]).toHaveProperty('header');
    // The user still gets a plain-text acknowledgement; no operator text send.
    expect(send.mock.calls.some(([chat]) => chat === 'op-chat')).toBe(false);
  });

  it('an affirmative while scope is incomplete does NOT hand off', async () => {
    const store = makeStore();
    const send = jest.fn(async (_chatId: string, _text: string) => {});
    const llm = makeLlm('I still need the targets.', { environment: 'staging' }); // incomplete
    const svc = new ConversationService({ store, llm, connectors: [fakeDocConnector], send, operatorChatId: 'op-chat' });

    await svc.handleTurn(turn('Yes, please proceed'));

    expect(store._conv.status).toBe('ACTIVE');
    expect(send.mock.calls.some(([chat]) => chat === 'op-chat')).toBe(false);
  });

  it('surfaces a converse failure and does not advance scope', async () => {
    const store = makeStore();
    const send = jest.fn(async (_chatId: string, _text: string) => {});
    const llm: MessageClient = {
      messages: { async create() { throw new Error('bedrock down'); } },
    };
    const svc = new ConversationService({ store, llm, connectors: [fakeDocConnector], send });

    await svc.handleTurn(turn('hello'));

    expect(send.mock.calls.some(([, msg]) => /problem|try again|continue/i.test(msg))).toBe(true);
    expect(store._conv.scope.environment).toBe('unknown'); // unchanged
  });

  it('swallows an extract-call failure: reply still sent, scope unchanged, no throw', async () => {
    const store = makeStore();
    const send = jest.fn(async (_chatId: string, _text: string) => {});
    const llm: MessageClient & { calls: any[] } = {
      calls: [],
      messages: {
        async create(params: any) {
          (llm.calls as any[]).push(params);
          if (params.system?.includes('extract a structured pentest scope')) {
            throw new Error('extract boom');
          }
          return { content: [{ type: 'text', text: 'Following up on scope.' }], usage: { input_tokens: 1, output_tokens: 1 } };
        },
      },
    };
    const svc = new ConversationService({ store, llm, connectors: [fakeDocConnector], send });

    await expect(svc.handleTurn(turn('hello'))).resolves.toBeUndefined(); // does not throw
    expect(send).toHaveBeenCalledWith('chat-1', 'Following up on scope.'); // reply sent
    expect(store._msgs.map((m) => m.role)).toEqual(['user', 'assistant']); // both persisted
    expect(store._conv.scope.environment).toBe('unknown'); // scope NOT advanced
  });

  it('hands off with operatorChatId unset: flips status, notifies only the user, no throw', async () => {
    const store = makeStore();
    const full: PentestScope = {
      targets: ['app.example.com'], inScope: 'web app', environment: 'staging',
      rulesOfEngagement: 'no DoS', timingWindow: 'next week', testType: 'web',
      contacts: 'ops@example.com',
    };
    store._conv.scope = full;
    const send = jest.fn(async (_chatId: string, _text: string) => {});
    const llm = makeLlm('Great, handing off.', full);
    const svc = new ConversationService({ store, llm, connectors: [fakeDocConnector], send }); // no operatorChatId

    await expect(svc.handleTurn(turn('Yes, please proceed'))).resolves.toBeUndefined();
    expect(store._conv.status).toBe('READY_FOR_REVIEW');     // status still flips
    expect(send.mock.calls.every(([chat]) => chat === 'chat-1')).toBe(true); // only the user notified
  });

  it('ingests a duplicate document reference only once per message', async () => {
    const store = makeStore();
    const send = jest.fn(async (_chatId: string, _text: string) => {});
    const llm = makeLlm('Reading that.', {});
    const svc = new ConversationService({ store, llm, connectors: [fakeDocConnector], send });

    const url = 'https://acme.larksuite.com/docx/Abc';
    await svc.handleTurn(turn(`see ${url} and again ${url}`));

    const ingested = store._docs.filter((d) => d.sourceRef === url && d.status === 'ingested');
    expect(ingested).toHaveLength(1);
  });

  it('serializes overlapping turns for the same chat', async () => {
    const store = makeStore();
    const send = jest.fn(async (_chatId: string, _text: string) => {});
    const order: string[] = [];
    // LLM records call order; converse returns a reply, extract returns empty scope.
    const llm: MessageClient = {
      messages: {
        async create(params: any) {
          const isExtract = params.system?.includes('extract a structured pentest scope');
          order.push(isExtract ? 'extract' : 'converse');
          return { content: [{ type: 'text', text: isExtract ? JSON.stringify(emptyScope()) : 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } };
        },
      },
    };
    const svc = new ConversationService({ store, llm, connectors: [fakeDocConnector], send });

    await Promise.all([
      svc.handleTurn(turn('first', 'k-1')),
      svc.handleTurn(turn('second', 'k-2')),
    ]);

    // Two full turns ran, each converse+extract, and turn 1 fully completed before turn 2 started.
    expect(order).toEqual(['converse', 'extract', 'converse', 'extract']);
    expect(store._msgs.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['first', 'second']);
  });
});
