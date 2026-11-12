// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { telegramWebhookGate } from './webhook';

const { config } = vi.hoisted(() => ({
  config: { current: undefined as undefined | { botToken: string; webhookSecret?: string } },
}));

vi.mock('@/config/messenger', () => ({ getMessengerTelegramConfig: async () => config.current }));

const ctx = { invalidateBot: vi.fn() };

/** A forged tap on an approval button, in a linked user's name. */
const tap = (secret?: string) =>
  new Request('https://app.biber.test/api/agent/messenger/webhooks/telegram', {
    body: JSON.stringify({
      callback_query: {
        data: 'messenger:approve:msg_victim',
        from: { id: 42 },
        id: 'cb-1',
        message: { chat: { id: 42 }, message_id: 7 },
      },
    }),
    headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
    method: 'POST',
  });

beforeEach(() => {
  config.current = { botToken: 'bot-token', webhookSecret: 'the-secret' };
});

describe('telegramWebhookGate', () => {
  it('refuses an update without the webhook secret, before any button tap is read', async () => {
    expect((await telegramWebhookGate.preprocess(tap(), '', ctx))?.status).toBe(401);
    expect((await telegramWebhookGate.preprocess(tap('a-guess'), '', ctx))?.status).toBe(401);
  });

  it('lets an update from Telegram through', async () => {
    expect(await telegramWebhookGate.preprocess(tap('the-secret'), '', ctx)).toBeNull();
  });

  it('has nothing to check when the bot was stored without a secret', async () => {
    config.current = { botToken: 'bot-token' };

    expect(await telegramWebhookGate.preprocess(tap(), '', ctx)).toBeNull();
  });
});
