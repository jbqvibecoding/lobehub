// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertUserInputAllowed,
  contentSafetyHooks,
  INPUT_WITHHELD_PLACEHOLDER,
  REPLY_HIDDEN_NOTICE,
  reviewModelReply,
} from '../index';

const env = vi.hoisted(() => ({
  green: {
    ALIYUN_GREEN_ACCESS_KEY_ID: 'ak' as string | undefined,
    ALIYUN_GREEN_ACCESS_KEY_SECRET: 'secret' as string | undefined,
    ALIYUN_GREEN_ENDPOINT: 'http://127.0.0.1:4090',
    CONTENT_SAFETY_ON_ERROR: undefined as 'allow' | 'block' | undefined,
  },
  region: { APP_REGION: 'cn' },
}));
vi.mock('@/envs/contentSafety', () => ({ contentSafetyEnv: env.green }));
vi.mock('@/envs/region', () => ({ regionEnv: env.region }));

const verdict = (riskLevel: string, labels: string[] = []) =>
  Response.json({
    Code: 200,
    Data: { Result: labels.map((Label) => ({ Label })), RiskLevel: riskLevel },
  });

const fetchSpy = vi.spyOn(globalThis, 'fetch');

const sentContent = (call: number) => {
  const url = new URL(fetchSpy.mock.calls[call][0] as string);
  return {
    content: JSON.parse(url.searchParams.get('ServiceParameters')!).content as string,
    service: url.searchParams.get('Service'),
  };
};

beforeEach(() => {
  env.region.APP_REGION = 'cn';
  env.green.ALIYUN_GREEN_ACCESS_KEY_ID = 'ak';
  env.green.CONTENT_SAFETY_ON_ERROR = undefined;
});

afterEach(() => {
  fetchSpy.mockReset();
});

describe('assertUserInputAllowed', () => {
  it("checks the user's latest words, signed for Text Moderation Plus", async () => {
    fetchSpy.mockResolvedValue(verdict('low'));

    await assertUserInputAllowed([
      { content: 'You are Biber.', role: 'system' },
      { content: [{ text: 'Plan my trip', type: 'text' }], role: 'user' },
    ]);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).origin).toBe('http://127.0.0.1:4090');
    expect((init.headers as Record<string, string>)['x-acs-action']).toBe('TextModerationPlus');
    expect((init.headers as Record<string, string>).authorization).toMatch(
      /^ACS3-HMAC-SHA256 Credential=ak,/,
    );
    expect(sentContent(0)).toEqual({ content: 'Plan my trip', service: 'llm_query_moderation' });
  });

  it('refuses a request the check flags as high risk', async () => {
    fetchSpy.mockResolvedValue(verdict('high', ['political_content']));

    await expect(
      assertUserInputAllowed([{ content: 'something flagged', role: 'user' }]),
    ).rejects.toMatchObject({ errorType: 'ContentModeration' });
  });

  it('refuses a flagged message even with the reply being written after it', async () => {
    fetchSpy.mockResolvedValue(verdict('high'));

    await expect(
      assertUserInputAllowed([
        { content: 'something flagged', role: 'user' },
        { content: '...', role: 'assistant' },
      ]),
    ).rejects.toMatchObject({ errorType: 'ContentModeration' });
  });

  it('keeps a message refused earlier out of the history a later turn sends', async () => {
    fetchSpy.mockImplementation(async (url) =>
      verdict(decodeURIComponent(String(url)).includes('BLOCKME') ? 'high' : 'none'),
    );
    const messages = [
      { content: 'BLOCKME earlier', role: 'user' },
      { content: 'Sorry.', role: 'assistant' },
      { content: 'And now something fine', role: 'user' },
    ];

    await expect(assertUserInputAllowed(messages)).resolves.toBeUndefined();

    expect(messages[0].content).toBe(INPUT_WITHHELD_PLACEHOLDER);
    expect(messages[2].content).toBe('And now something fine');
  });

  it("does not refuse an agent's later step, which ends with tool results", async () => {
    fetchSpy.mockResolvedValue(verdict('none'));

    await expect(
      assertUserInputAllowed([
        { content: 'Book the hotel', role: 'user' },
        { content: '{"booked":true}', role: 'tool' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('checks each message once, however many calls carry it', async () => {
    fetchSpy.mockResolvedValue(verdict('none'));
    const messages = [{ content: 'Checked only once', role: 'user' }];

    await assertUserInputAllowed(messages);
    await assertUserInputAllowed(messages);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('checks long text in pieces, at most five', async () => {
    fetchSpy.mockImplementation(async () => verdict('none'));

    await assertUserInputAllowed([{ content: 'a'.repeat(4500), role: 'user' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(sentContent(2).content).toHaveLength(500);

    fetchSpy.mockClear();
    await assertUserInputAllowed([{ content: `${'a'.repeat(20_000)}tail`, role: 'user' }]);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(sentContent(4).content.endsWith('tail')).toBe(true);
  });

  it('refuses when the check cannot be made, unless told to let it through', async () => {
    fetchSpy.mockRejectedValue(new Error('timeout'));
    const messages = [{ content: 'hello', role: 'user' }];

    await expect(assertUserInputAllowed(messages)).rejects.toMatchObject({
      errorType: 'ContentModeration',
    });

    env.green.CONTENT_SAFETY_ON_ERROR = 'allow';
    await expect(assertUserInputAllowed(messages)).resolves.toBeUndefined();
  });

  it('does nothing in the international edition or without an AccessKey', async () => {
    env.region.APP_REGION = 'global';
    await assertUserInputAllowed([{ content: 'hello', role: 'user' }]);
    expect(contentSafetyHooks()).toBeUndefined();

    env.region.APP_REGION = 'cn';
    env.green.ALIYUN_GREEN_ACCESS_KEY_ID = undefined;
    await assertUserInputAllowed([{ content: 'hello', role: 'user' }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('runs before every model call through the runtime hook', async () => {
    fetchSpy.mockResolvedValue(verdict('high'));

    await expect(
      contentSafetyHooks()!.beforeChat!({ messages: [{ content: 'x', role: 'user' }] } as any),
    ).rejects.toMatchObject({ errorType: 'ContentModeration' });
  });
});

describe('reviewModelReply', () => {
  it('hides a reply the check flags, and checks it as a model response', async () => {
    fetchSpy.mockResolvedValue(verdict('high'));

    expect(await reviewModelReply('a flagged reply')).toBe('hidden');
    expect(sentContent(0).service).toBe('llm_response_moderation');
    expect(REPLY_HIDDEN_NOTICE).toContain('已隐藏');
  });

  it('shows a reply that passes', async () => {
    fetchSpy.mockResolvedValue(verdict('medium'));

    expect(await reviewModelReply('a fine reply')).toBe('allowed');
  });

  it('hides a reply that could not be checked, unless told to let it through', async () => {
    fetchSpy.mockResolvedValue(Response.json({ Code: 500, Message: 'busy' }, { status: 500 }));

    expect(await reviewModelReply('a reply')).toBe('hidden');
    env.green.CONTENT_SAFETY_ON_ERROR = 'allow';
    expect(await reviewModelReply('a reply')).toBe('allowed');
  });
});
