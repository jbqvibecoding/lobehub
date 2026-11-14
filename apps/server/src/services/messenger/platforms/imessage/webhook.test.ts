// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { imessageWebhookGate } from './webhook';

const preprocess = (body: unknown) =>
  imessageWebhookGate.preprocess(
    new Request('https://app.example.com/api/agent/messenger/webhooks/imessage', {
      method: 'POST',
    }),
    typeof body === 'string' ? body : JSON.stringify(body),
    { invalidateBot: vi.fn() },
  );

describe('imessageWebhookGate', () => {
  it('acknowledges a group chat message without passing it on', async () => {
    const res = await preprocess({
      data: { chat: { id: 'chat-g', is_group: true }, direction: 'inbound' },
      event_type: 'message.received',
    });

    expect(res?.status).toBe(200);
  });

  it('passes a one-to-one iMessage on to the adapter', async () => {
    const res = await preprocess({
      data: {
        chat: { id: 'chat-1', is_group: false },
        direction: 'inbound',
        sender_handle: { handle: '+12025550147', service: 'iMessage' },
      },
      event_type: 'message.received',
    });

    expect(res).toBeNull();
  });

  // Users are known by their number, and a text message's sender number can be forged
  it('acknowledges a message sent as SMS or RCS without passing it on', async () => {
    for (const service of ['SMS', 'RCS', undefined]) {
      const res = await preprocess({
        data: {
          chat: { id: 'chat-1', is_group: false },
          direction: 'inbound',
          sender_handle: { handle: '+12025550147', service },
        },
        event_type: 'message.received',
      });

      expect(res?.status).toBe(200);
    }
  });

  it('leaves a body it cannot read to the adapter, which rejects it', async () => {
    expect(await preprocess('not json')).toBeNull();
  });
});
