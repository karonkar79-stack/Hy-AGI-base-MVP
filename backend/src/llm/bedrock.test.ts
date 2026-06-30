/**
 * Tests for the Bedrock client's transient-failure retry.
 *
 * The first outbound call to Bedrock can fail at the network layer ("fetch
 * failed" with no HTTP status — a cold-connection/TLS blip) and then succeed on
 * a warmed connection. The chatbot calls messages.create() directly (no
 * BaseAgent retry), so the client itself must retry network-level failures.
 * HTTP error responses (which carry a status) must NOT be retried here.
 */

const REAL_FETCH = global.fetch;

describe('createBedrockClient retry', () => {
  beforeAll(() => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'test-token';
    process.env.BEDROCK_REGION = 'us-east-1';
    process.env.BEDROCK_MODEL_ID = 'us.anthropic.claude-sonnet-4-6';
  });
  afterEach(() => {
    global.fetch = REAL_FETCH;
    jest.resetModules();
  });

  function okResponse() {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    } as any;
  }

  it('retries a transient network failure ("fetch failed") and then succeeds', async () => {
    const { createBedrockClient } = require('./bedrock');
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed'); // network-level, no status
      return okResponse();
    }) as any;

    const client = createBedrockClient();
    const res = await client.messages.create({ messages: [{ role: 'user', content: 'hi' }] });

    expect(calls).toBe(2); // failed once, retried, succeeded
    expect(res.usage.input_tokens).toBe(1);
  });

  it('does NOT retry an HTTP error response (e.g. 400) and surfaces its status', async () => {
    const { createBedrockClient } = require('./bedrock');
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => '{"message":"not authorized"}',
      } as any;
    }) as any;

    const client = createBedrockClient();
    await expect(
      client.messages.create({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(1); // no retry on a real HTTP error
  });

  it('gives up after exhausting retries on persistent network failure', async () => {
    const { createBedrockClient } = require('./bedrock');
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    }) as any;

    const client = createBedrockClient();
    await expect(
      client.messages.create({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(/fetch failed/);
    expect(calls).toBeGreaterThanOrEqual(2); // initial + at least one retry
  });
});
