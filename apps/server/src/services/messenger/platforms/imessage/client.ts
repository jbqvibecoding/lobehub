import { createLinqAdapter } from '@linqapp/chat-sdk-adapter';
import type { AdapterPostableMessage } from 'chat';
import debug from 'debug';

import type {
  BotMessageAttachment,
  MessengerContent,
  PlatformClient,
  PlatformMessenger,
} from '@/server/services/bot/platforms';

import { IMESSAGE_INSTALLATION_KEY } from '../../installations/imessage';

const log = debug('lobe-server:messenger:imessage:client');

/**
 * The Chat SDK resolves adapters by the thread id's prefix, and the Linq adapter writes its thread
 * ids as `linq:<chatId>`, so it must be registered under this name.
 */
export const LINQ_ADAPTER_NAME = 'linq';

export interface LinqLineCredentials {
  apiKey: string;
  signingSecret: string;
}

export const linqThreadId = (chatId: string) => `${LINQ_ADAPTER_NAME}:${chatId}`;

/** `linq:<chatId>` (and the adapter's legacy `linq:<chatId>:dm`) → `<chatId>`. */
export const linqChatId = (platformThreadId: string) => platformThreadId.split(':')[1] ?? '';

export const createLinqLineAdapter = ({ apiKey, signingSecret }: LinqLineCredentials) =>
  createLinqAdapter({ apiKey, signingSecret });

type LinqAdapter = ReturnType<typeof createLinqLineAdapter>;

/**
 * Replies go out as plain text: iMessage shows markdown markers literally, and the agent is told
 * the platform has no markdown. Attachments ride along as media parts, by URL when the bytes are
 * fetchable and uploaded otherwise.
 */
const toPostable = (content: MessengerContent): AdapterPostableMessage => {
  if (typeof content === 'string') return content;

  const text = content.content ?? '';
  const attachments = content.attachments ?? [];
  if (attachments.length === 0) return text;

  const byUrl = attachments.filter((a) => a.fetchUrl);
  const byBytes = attachments.filter((a): a is BotMessageAttachment & { data: string } =>
    Boolean(!a.fetchUrl && a.data),
  );

  return {
    attachments: byUrl.map((a) => ({
      mimeType: a.mimeType,
      name: a.name,
      type: a.type,
      url: a.fetchUrl,
    })),
    files: byBytes.map((a) => ({
      data: Buffer.from(a.data, 'base64'),
      filename: a.name ?? 'file',
      mimeType: a.mimeType,
    })),
    raw: text,
  };
};

/**
 * Outbound and inbound iMessage for the shared Biber line. Linq delivers inbound messages by
 * webhook, registered once on the Linq dashboard, so there is nothing to start or stop here.
 */
export class LinqImessageClient implements PlatformClient {
  readonly id = 'imessage';
  readonly applicationId = IMESSAGE_INSTALLATION_KEY;

  private outbound?: LinqAdapter;

  constructor(private readonly credentials: LinqLineCredentials) {}

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  createAdapter(): Record<string, any> {
    return { [LINQ_ADAPTER_NAME]: createLinqLineAdapter(this.credentials) };
  }

  /** One adapter for sends outside a Chat SDK bot (callbacks, link notices); it needs no Chat. */
  outboundAdapter(): LinqAdapter {
    this.outbound ??= createLinqLineAdapter(this.credentials);
    return this.outbound;
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const adapter = this.outboundAdapter();
    return {
      addReaction: async (messageId, emoji) => {
        await adapter.addReaction(platformThreadId, messageId, emoji);
      },
      createMessage: async (content) => {
        const postable = toPostable(content);
        if (typeof postable === 'string' && !postable.trim()) return;
        await adapter.postMessage(platformThreadId, postable);
      },
      editMessage: async (messageId, content) => {
        await adapter.editMessage(platformThreadId, messageId, toPostable(content));
      },
      removeReaction: async (messageId, emoji) => {
        await adapter.removeReaction(platformThreadId, messageId, emoji);
      },
      triggerTyping: async () => {
        try {
          await adapter.startTyping(platformThreadId);
        } catch (error) {
          // Linq refuses typing in group chats and on SMS; a missing indicator is not an error.
          log('typing not shown for %s: %O', platformThreadId, error);
        }
      },
    };
  }

  extractChatId(platformThreadId: string): string {
    return linqChatId(platformThreadId);
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}
