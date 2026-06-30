// src/chat/prompts.test.ts
import { parseScopeJson, buildContext, extractPrompt, conversePrompt } from './prompts';
import { MessageRow, DocumentRow } from './store';

describe('parseScopeJson', () => {
  it('parses a fenced JSON block and coerces fields', () => {
    const raw =
      'Here is the scope:\n```json\n' +
      JSON.stringify({
        targets: ['app.example.com'],
        inScope: 'web app',
        environment: 'staging',
        rulesOfEngagement: 'no DoS',
        timingWindow: 'next week',
        testType: 'web',
        contacts: 'ops@example.com',
      }) +
      '\n```\nLet me know.';
    const scope = parseScopeJson(raw);
    expect(scope.targets).toEqual(['app.example.com']);
    expect(scope.environment).toBe('staging');
    expect(scope.contacts).toBe('ops@example.com');
  });

  it('falls back to unknown for missing fields and bad input', () => {
    const scope = parseScopeJson('no json at all');
    expect(scope.environment).toBe('unknown');
    expect(scope.targets).toBe('unknown');
    const partial = parseScopeJson('{"environment":"prod"}');
    expect(partial.environment).toBe('prod');
    expect(partial.inScope).toBe('unknown');
  });

  it('normalizes an out-of-range environment to unknown', () => {
    const scope = parseScopeJson('{"environment":"banana"}');
    expect(scope.environment).toBe('unknown');
  });

  it('does not break when trailing prose contains braces', () => {
    const raw = '```json\n{"environment":"prod"}\n```\nSee {redacted}.';
    expect(parseScopeJson(raw).environment).toBe('prod');
  });
});

describe('buildContext', () => {
  it('includes document text and the labelled transcript', () => {
    const docs: DocumentRow[] = [
      {
        id: 'd1',
        conversationId: 'c1',
        connectorType: 'lark_doc',
        sourceRef: 'r',
        title: 'Reqs',
        sourceUrl: 'http://x/docx/1',
        content: 'Target is the billing API.',
        status: 'ingested',
        error: null,
        createdAt: '2026-06-30',
      },
    ];
    const msgs: MessageRow[] = [
      { id: 'm1', conversationId: 'c1', eventId: null, role: 'user', content: 'hi', createdAt: '1' },
      { id: 'm2', conversationId: 'c1', eventId: null, role: 'assistant', content: 'hello', createdAt: '2' },
    ];
    const ctx = buildContext(docs, msgs);
    expect(ctx).toContain('Target is the billing API.');
    expect(ctx).toContain('user: hi');
    expect(ctx).toContain('assistant: hello');
  });
});

describe('prompt routing contract', () => {
  it('extractPrompt contains the routing phrase Task 5 keys on', () => {
    expect(extractPrompt()).toContain('extract a structured pentest scope');
  });
  it('conversePrompt does not contain the routing phrase', () => {
    expect(conversePrompt([])).not.toContain('extract a structured pentest scope');
  });
});
