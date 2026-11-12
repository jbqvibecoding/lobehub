import type { AdapterPostableMessage } from 'chat';
import debug from 'debug';

import type { AttachmentSource } from '@/server/services/aiAgent/ingestAttachment';
import type {
  MessengerContent,
  PlatformClient,
  PlatformMessenger,
} from '@/server/services/bot/platforms';
import { stripMarkdown } from '@/server/services/bot/platforms/stripMarkdown';

import { WECHAT_INSTALLATION_KEY } from '../../installations/wechat';
import { openIdOfThread, WECHAT_MP_ADAPTER_NAME, WechatMpAdapter } from './adapter';
import { createWechatMpApi, type WechatMpApi } from './api';
import type { WechatMpSecrets } from './protocol';

const log = debug('lobe-server:messenger:wechat:client');

export interface WechatMpCredentials extends WechatMpSecrets {
  appSecret: string;
}

const toPostable = (content: MessengerContent): AdapterPostableMessage => {
  if (typeof content === 'string') return { markdown: content };
  return {
    attachments: (content.attachments ?? [])
      .filter((attachment) => attachment.fetchUrl || attachment.data)
      .map((attachment) => ({
        fetchData: attachment.data
          ? async () => Buffer.from(attachment.data!, 'base64')
          : undefined,
        mimeType: attachment.mimeType,
        name: attachment.name,
        type: attachment.type,
        url: attachment.fetchUrl,
      })),
    markdown: content.content ?? '',
  };
};

/** Outbound and inbound for the shared WeChat Official Account. */
export class WechatMpClient implements PlatformClient {
  readonly id = 'wechat';
  readonly applicationId = WECHAT_INSTALLATION_KEY;

  readonly api: WechatMpApi;
  private outbound?: WechatMpAdapter;

  constructor(private readonly credentials: WechatMpCredentials) {
    this.api = createWechatMpApi(credentials);
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  createAdapter(): Record<string, any> {
    return { [WECHAT_MP_ADAPTER_NAME]: new WechatMpAdapter(this.credentials, this.api) };
  }

  /** One adapter for sends outside a Chat SDK bot (callbacks, link notices). */
  outboundAdapter(): WechatMpAdapter {
    this.outbound ??= new WechatMpAdapter(this.credentials, this.api);
    return this.outbound;
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const adapter = this.outboundAdapter();
    return {
      addReaction: async () => {},
      createMessage: async (content) => {
        await adapter.postMessage(platformThreadId, toPostable(content));
      },
      editMessage: async (_messageId, content) => {
        await adapter.postMessage(platformThreadId, toPostable(content));
      },
      removeReaction: async () => {},
      triggerTyping: async () => {
        await adapter.startTyping(platformThreadId);
      },
    };
  }

  formatMarkdown(markdown: string): string {
    return stripMarkdown(markdown);
  }

  /** Images arrive as a link to WeChat's CDN; the agent gets the bytes. */
  async extractFiles(message: { raw?: unknown }): Promise<AttachmentSource[] | undefined> {
    const url = (message.raw as { MsgType?: string; PicUrl?: string } | undefined)?.PicUrl;
    if (!url) return undefined;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      return [
        {
          buffer,
          mimeType: response.headers.get('content-type') || 'image/jpeg',
          name: 'image.jpg',
          size: buffer.length,
        },
      ];
    } catch (error) {
      log('extractFiles: downloading %s failed: %O', url, error);
      return undefined;
    }
  }

  extractChatId(platformThreadId: string): string {
    return openIdOfThread(platformThreadId);
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }
}
