// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { agentOperations } from '@/database/schemas';
import { users } from '@/database/schemas/user';

import { createUsageMeter, creditsFor, forwardMessages } from '../index';

const mocks = vi.hoisted(() => ({
  assertUserInputAllowed: vi.fn(),
  chargeCredits: vi.fn(),
  coding: {} as Record<string, string | undefined>,
  getAllowance: vi.fn(),
  getModelPricing: vi.fn(),
  region: { APP_REGION: 'global' },
  validateOIDCJWT: vi.fn(),
}));

vi.mock('@/envs/coding', () => ({ codingEnv: mocks.coding }));
vi.mock('@/envs/llm', () => ({
  llmEnv: { ANTHROPIC_API_KEY: 'platform-anthropic', DEEPSEEK_API_KEY: 'platform-deepseek' },
}));
vi.mock('@/envs/region', () => ({ regionEnv: mocks.region }));
vi.mock('@/libs/oidc-provider/jwt', () => ({ validateOIDCJWT: mocks.validateOIDCJWT }));
vi.mock('@/libs/oidc-provider/access-control', () => ({
  assertOIDCUserActive: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/server/services/billing', () => ({
  BillingService: vi.fn().mockImplementation(() => ({
    chargeCredits: mocks.chargeCredits,
    getAllowance: mocks.getAllowance,
  })),
}));
vi.mock('@/server/services/contentSafety', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertUserInputAllowed: mocks.assertUserInputAllowed,
}));
vi.mock('@lobechat/model-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getModelPricing: mocks.getModelPricing,
}));

const db = await getTestDB();
const userId = 'coding-user';
// $3 per million input tokens, $15 per million output tokens
const PRICING = {
  units: [
    { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
  ],
};

const call = (body: unknown, headers: Record<string, string> = {}) =>
  forwardMessages(
    db,
    new Request('http://localhost/api/coding/anthropic/v1/messages', {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-api-key': 'run-token', ...headers },
      method: 'POST',
    }),
  );

const ask = {
  max_tokens: 100,
  messages: [{ content: 'Add a README', role: 'user' }],
  model: 'claude-x',
};

const sse = (events: object[]) =>
  events
    .map((event) => `event: ${(event as any).type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(async () => {
  for (const key of Object.keys(mocks.coding)) delete mocks.coding[key];
  mocks.region.APP_REGION = 'global';
  mocks.validateOIDCJWT.mockReset().mockResolvedValue({
    tokenData: { op: 'op-run', purpose: 'hetero-run', sub: userId, topic: 'tpc-1' },
    userId,
  });
  mocks.getAllowance.mockReset().mockResolvedValue({
    period: { end: new Date('2026-12-01T00:00:00Z') },
    remainingCredits: 1000,
  });
  mocks.chargeCredits.mockReset().mockResolvedValue(undefined);
  mocks.assertUserInputAllowed.mockReset().mockResolvedValue(undefined);
  mocks.getModelPricing.mockReset().mockResolvedValue(PRICING);

  await db.delete(agentOperations);
  await db.delete(users);
  await db.insert(users).values({ id: userId });
  await db.insert(agentOperations).values({ id: 'op-run', status: 'running', userId });

  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('who may call', () => {
  it('only a run token, only while its run is going', async () => {
    const refused = async (response: Response) => {
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { type: 'authentication_error' } });
    };

    await refused(await call(ask, { 'x-api-key': '' }));

    mocks.validateOIDCJWT.mockResolvedValueOnce({
      tokenData: { purpose: 'cli-sandbox', sub: userId },
      userId,
    });
    await refused(await call(ask));

    mocks.validateOIDCJWT.mockRejectedValueOnce(new Error('expired'));
    await refused(await call(ask));

    await db.update(agentOperations).set({ status: 'done' });
    await refused(await call(ask));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses once the month’s credits are used up', async () => {
    mocks.getAllowance.mockResolvedValue({
      period: { end: new Date('2026-12-01T00:00:00Z') },
      remainingCredits: 0,
    });

    const response = await call(ask);

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain('credits are used up');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses what the mainland check flags, checking the user’s words and not tool results', async () => {
    mocks.assertUserInputAllowed.mockRejectedValue({
      error: { labels: [], message: 'The request was refused by content safety' },
      errorType: 'ContentModeration',
    });

    const response = await call({
      ...ask,
      messages: [
        { content: 'Add a README', role: 'user' },
        { content: [{ id: 't1', input: {}, name: 'Read', type: 'tool_use' }], role: 'assistant' },
        {
          content: [
            { content: 'file text', tool_use_id: 't1', type: 'tool_result' },
            { text: 'and push it', type: 'text' },
          ],
          role: 'user',
        },
      ],
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe('The request was refused by content safety');
    expect(mocks.assertUserInputAllowed).toHaveBeenCalledWith([
      { content: 'Add a README', role: 'user' },
      { content: 'and push it', role: 'user' },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('forwarding', () => {
  it('sends the configured model with the platform key, and charges the call', async () => {
    fetchSpy.mockResolvedValue(
      Response.json({
        content: [{ text: 'Done', type: 'text' }],
        usage: { input_tokens: 1000, output_tokens: 2000 },
      }),
    );

    const response = await call(ask, { 'anthropic-beta': 'some-beta' });

    expect(response.status).toBe(200);
    expect((await response.json()).content[0].text).toBe('Done');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.parse(init.body as string).model).toBe('claude-sonnet-5');
    expect(init.headers).toMatchObject({
      'anthropic-beta': 'some-beta',
      'x-api-key': 'platform-anthropic',
    });
    expect(JSON.stringify(init.headers)).not.toContain('run-token');
    expect(mocks.getModelPricing).toHaveBeenCalledWith('claude-sonnet-5', 'anthropic');
    expect(mocks.chargeCredits).toHaveBeenCalledWith(
      await creditsFor({ input_tokens: 1000, output_tokens: 2000 }, { model: 'm', provider: 'p' }),
    );
  });

  it('goes to DeepSeek’s Anthropic endpoint on the mainland, without Anthropic’s beta headers', async () => {
    mocks.region.APP_REGION = 'cn';
    fetchSpy.mockResolvedValue(Response.json({ usage: { input_tokens: 1, output_tokens: 1 } }));

    await call(ask, { 'anthropic-beta': 'some-beta' });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/anthropic/v1/messages');
    expect(JSON.parse(init.body as string).model).toBe('deepseek-v4-pro');
    expect(init.headers).toMatchObject({ 'x-api-key': 'platform-deepseek' });
    expect(init.headers).not.toHaveProperty('anthropic-beta');
  });

  it('follows the CODING_* settings', async () => {
    Object.assign(mocks.coding, {
      CODING_BASE_URL: 'http://127.0.0.1:4010/anthropic/',
      CODING_MODEL: 'deepseek-v4-flash',
      CODING_MODEL_PROVIDER: 'deepseek',
    });
    fetchSpy.mockResolvedValue(Response.json({ usage: {} }));

    await call(ask);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4010/anthropic/v1/messages');
    expect(JSON.parse(init.body as string).model).toBe('deepseek-v4-flash');
  });

  it('streams the events through untouched and charges when the stream ends', async () => {
    const events = sse([
      { message: { usage: { input_tokens: 1000, output_tokens: 1 } }, type: 'message_start' },
      { delta: { text: 'Hi', type: 'text_delta' }, index: 0, type: 'content_block_delta' },
      { delta: { stop_reason: 'end_turn' }, type: 'message_delta', usage: { output_tokens: 2000 } },
      { type: 'message_stop' },
    ]);
    fetchSpy.mockResolvedValue(
      new Response(events, { headers: { 'content-type': 'text/event-stream' } }),
    );

    const response = await call({ ...ask, stream: true });

    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toBe(events);
    expect(mocks.chargeCredits).toHaveBeenCalledTimes(1);
    expect(mocks.chargeCredits).toHaveBeenCalledWith(
      await creditsFor({ input_tokens: 1000, output_tokens: 2000 }, { model: 'm', provider: 'p' }),
    );
  });

  it('passes a provider error back as it came, uncharged', async () => {
    fetchSpy.mockResolvedValue(
      Response.json(
        { error: { message: 'overloaded', type: 'overloaded_error' } },
        { status: 529 },
      ),
    );

    const response = await call(ask);

    expect(response.status).toBe(529);
    expect((await response.json()).error.type).toBe('overloaded_error');
    expect(mocks.chargeCredits).not.toHaveBeenCalled();
  });
});

describe('metering', () => {
  it('prices tokens at the model’s rates, rounded up to whole credits', async () => {
    const credits = await creditsFor(
      { input_tokens: 1000, output_tokens: 2000 },
      { model: 'm', provider: 'p' },
    );
    // $0.003 + $0.03
    expect(credits).toBeGreaterThan(0);
    expect(
      await creditsFor({ input_tokens: 2000, output_tokens: 4000 }, { model: 'm', provider: 'p' }),
    ).toBeGreaterThanOrEqual(credits! * 2 - 1);

    mocks.getModelPricing.mockResolvedValue(undefined);
    expect(await creditsFor({ input_tokens: 1 }, { model: 'm', provider: 'p' })).toBeUndefined();
  });

  it('reads usage split across chunks, keeping running totals', () => {
    const meter = createUsageMeter();
    const text = sse([
      {
        message: { usage: { cache_read_input_tokens: 50, input_tokens: 10 } },
        type: 'message_start',
      },
      { type: 'message_delta', usage: { input_tokens: 0, output_tokens: 7 } },
      { type: 'message_delta', usage: { output_tokens: 12 } },
    ]);
    const bytes = new TextEncoder().encode(text);
    meter.push(bytes.slice(0, 37));
    meter.push(bytes.slice(37));

    expect(meter.usage()).toEqual({
      cache_read_input_tokens: 50,
      input_tokens: 10,
      output_tokens: 12,
    });
  });
});
