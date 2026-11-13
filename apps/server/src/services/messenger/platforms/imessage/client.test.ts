// @vitest-environment node
import { createLinqAdapter } from '@linqapp/chat-sdk-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinqImessageClient } from './client';

vi.mock('@linqapp/chat-sdk-adapter', () => ({ createLinqAdapter: vi.fn() }));

const adapter = {
  editMessage: vi.fn(),
  // What the Linq adapter makes of a message: the sender is Linq's participant id
  parseMessage: vi.fn((raw: any) => ({
    author: { userId: raw.sender_handle?.id ?? 'unknown', userName: raw.sender_handle?.handle },
    text: 'hi',
  })),
  postMessage: vi.fn(),
  startTyping: vi.fn(),
};

const client = () => new LinqImessageClient({ apiKey: 'linq-key', signingSecret: 'whsec_test' });

beforeEach(() => {
  vi.mocked(createLinqAdapter).mockReturnValue(adapter as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LinqImessageClient', () => {
  // The Chat SDK finds a thread's adapter by the thread id prefix, and Linq threads are `linq:…`.
  it('registers its Chat SDK adapter under the name its thread ids carry', () => {
    expect(Object.keys(client().createAdapter())).toEqual(['linq']);
    expect(createLinqAdapter).toHaveBeenCalledWith({
      apiKey: 'linq-key',
      signingSecret: 'whsec_test',
    });
  });

  it("knows the sender by their phone number or email, not by Linq's participant id", () => {
    const linq = client().createAdapter().linq;

    const message = linq.parseMessage({
      chat: { id: 'chat-1', is_group: false },
      direction: 'inbound',
      sender_handle: { handle: '+12025550147', id: 'handle-7f3a' },
    });

    expect(message.author.userId).toBe('+12025550147');
  });

  it('sends a reply to the thread as plain text', async () => {
    await client().getMessenger('linq:chat-1').createMessage('Booked the 9:40 train.');

    expect(adapter.postMessage).toHaveBeenCalledWith('linq:chat-1', 'Booked the 9:40 train.');
  });

  it('sends nothing for an empty reply', async () => {
    await client().getMessenger('linq:chat-1').createMessage('  ');

    expect(adapter.postMessage).not.toHaveBeenCalled();
  });

  it('sends fetchable attachments by URL and inline bytes as files', async () => {
    await client()
      .getMessenger('linq:chat-1')
      .createMessage({
        attachments: [
          {
            fetchUrl: 'https://files.example.com/chart.png',
            mimeType: 'image/png',
            name: 'chart.png',
            type: 'image',
          },
          { data: Buffer.from('hello').toString('base64'), name: 'note.txt', type: 'file' },
        ],
        content: 'Here is the chart.',
      });

    const [, postable] = adapter.postMessage.mock.calls[0];
    expect(postable.raw).toBe('Here is the chart.');
    expect(postable.attachments).toEqual([
      {
        mimeType: 'image/png',
        name: 'chart.png',
        type: 'image',
        url: 'https://files.example.com/chart.png',
      },
    ]);
    expect(postable.files).toHaveLength(1);
    expect(postable.files[0].filename).toBe('note.txt');
    expect(postable.files[0].data.toString()).toBe('hello');
  });

  it('carries on when Linq refuses a typing indicator', async () => {
    adapter.startTyping.mockRejectedValueOnce(new Error('typing not supported for SMS'));

    await expect(client().getMessenger('linq:chat-1').triggerTyping!()).resolves.toBeUndefined();
  });

  it('reads the Linq chat id out of a thread id', () => {
    expect(client().extractChatId('linq:9c1f0a2e')).toBe('9c1f0a2e');
  });
});
