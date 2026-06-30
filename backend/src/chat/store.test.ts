// src/chat/store.test.ts
import { ConversationStore } from './store';
import { emptyScope } from './scope';

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

d('ConversationStore (integration; requires DATABASE_URL + migrated schema)', () => {
  let store: ConversationStore;
  beforeAll(() => {
    store = new ConversationStore();
  });
  afterAll(async () => {
    await store.close();
  });

  it('creates, loads, appends messages, and persists scope round-trip', async () => {
    const chatId = `test-chat-${Date.now()}`;
    const conv = await store.getOrCreateByChatId(chatId, 'user-1');
    expect(conv.status).toBe('ACTIVE');

    // getOrCreate is idempotent for the same chat.
    const again = await store.getOrCreateByChatId(chatId);
    expect(again.id).toBe(conv.id);

    const key = `msg-${Date.now()}`;
    await store.appendMessage(conv.id, 'user', 'hello', key);
    expect(await store.messageExists(key)).toBe(true);
    await store.appendMessage(conv.id, 'assistant', 'hi there');
    const msgs = await store.getMessages(conv.id);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);

    const scope = emptyScope();
    scope.environment = 'staging';
    await store.updateScope(conv.id, scope);
    const reloaded = await store.getByChatId(chatId);
    expect(reloaded?.scope.environment).toBe('staging');

    await store.addDocument({
      conversationId: conv.id,
      connectorType: 'lark_doc',
      sourceRef: 'https://x.larksuite.com/docx/abc',
      title: 'Reqs',
      sourceUrl: 'https://x.larksuite.com/docx/abc',
      content: 'full text',
      status: 'ingested',
      error: null,
    });
    const docs = await store.getDocuments(conv.id);
    expect(docs[0].content).toBe('full text');

    await store.setStatus(conv.id, 'READY_FOR_REVIEW');
    expect((await store.getByChatId(chatId))?.status).toBe('READY_FOR_REVIEW');
  });
});
