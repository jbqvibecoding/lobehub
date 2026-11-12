import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  ChatInstance,
  EmojiValue,
  FetchResult,
  FileUpload,
  FormattedContent,
  Logger,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from 'chat';
import { Message, parseMarkdown, stringifyMarkdown } from 'chat';

import { stripMarkdown } from '@/server/services/bot/platforms/stripMarkdown';

import type { WechatMpApi } from './api';
import {
  readDelivery,
  type WechatMpFields,
  type WechatMpSecrets,
  WechatMpVerificationError,
} from './protocol';

/**
 * The Chat SDK resolves adapters by the thread id's prefix. `wechat` is taken by the per-agent
 * WeChat (iLink) channel, so the shared Official Account bot names its threads `wechatmp:<openid>`.
 */
export const WECHAT_MP_ADAPTER_NAME = 'wechatmp';

export const wechatMpThreadId = (openId: string) => `${WECHAT_MP_ADAPTER_NAME}:${openId}`;

/** `wechatmp:<openid>` → `<openid>`. */
export const openIdOfThread = (threadId: string) => threadId.slice(threadId.indexOf(':') + 1);

/** WeChat answers a reply-less delivery with `success`, so it neither retries nor warns the user. */
const acknowledged = () => new Response('success', { status: 200 });

/** What a follower sent, as text for the agent; undefined for what the bot does not take. */
export const inboundText = (fields: WechatMpFields): string | undefined => {
  switch (fields.MsgType) {
    case 'text': {
      return fields.Content;
    }
    case 'voice': {
      // WeChat's own transcript, when the account has speech recognition
      return fields.Recognition || undefined;
    }
    case 'image': {
      return '';
    }
    case 'location': {
      return `[位置] ${fields.Label ?? ''} (${fields.Location_X}, ${fields.Location_Y})`.trim();
    }
    case 'link': {
      return [fields.Title, fields.Description, fields.Url].filter(Boolean).join('\n');
    }
    default: {
      return undefined;
    }
  }
};

/** Replies are plain text: WeChat shows markdown markers as typed. */
export const plainTextOf = (message: AdapterPostableMessage): string => {
  if (typeof message === 'string') return message;
  if ('markdown' in message && typeof message.markdown === 'string') {
    return stripMarkdown(message.markdown);
  }
  if ('raw' in message && typeof message.raw === 'string') return message.raw;
  if ('ast' in message && message.ast) return stripMarkdown(stringifyMarkdown(message.ast));
  return '';
};

const toBuffer = async (data: ArrayBuffer | Blob | Buffer): Promise<Buffer> => {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(await data.arrayBuffer());
};

const imagesOf = async (message: AdapterPostableMessage) => {
  if (typeof message === 'string') return [];
  const images: { data: Buffer; filename: string; mimeType: string }[] = [];

  const attachments: Attachment[] =
    'attachments' in message && Array.isArray(message.attachments) ? message.attachments : [];
  for (const attachment of attachments) {
    if (attachment.type !== 'image') continue;
    const data = attachment.fetchData
      ? await toBuffer(await attachment.fetchData())
      : attachment.url
        ? Buffer.from(await (await fetch(attachment.url)).arrayBuffer())
        : undefined;
    if (data) {
      images.push({
        data,
        filename: attachment.name ?? 'image.png',
        mimeType: attachment.mimeType ?? 'image/png',
      });
    }
  }

  const files: FileUpload[] =
    'files' in message && Array.isArray(message.files) ? message.files : [];
  for (const file of files) {
    if (!file.mimeType?.startsWith('image/')) continue;
    images.push({
      data: await toBuffer(file.data),
      filename: file.filename,
      mimeType: file.mimeType,
    });
  }
  return images;
};

/**
 * The shared WeChat Official Account (服务号) for the Chat SDK. WeChat posts each follower's
 * message to our webhook; replies go out through the customer-service message API. Every chat is
 * one-to-one, between the account and one follower, who is known by their openid.
 */
export class WechatMpAdapter implements Adapter<string, WechatMpFields> {
  readonly name = WECHAT_MP_ADAPTER_NAME;
  readonly userName = 'wechat-official-account';
  private chat!: ChatInstance;
  private logger!: Logger;

  constructor(
    private readonly secrets: WechatMpSecrets,
    private readonly api: WechatMpApi,
  ) {}

  get botUserId() {
    return this.secrets.appId;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
  }

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    let fields: WechatMpFields;
    try {
      fields = readDelivery(this.secrets, new URL(request.url), await request.text());
    } catch (error) {
      if (error instanceof WechatMpVerificationError) {
        return new Response(error.message, { status: 401 });
      }
      throw error;
    }

    const openId = fields.FromUserName;
    const text = inboundText(fields);
    if (!openId || text === undefined) return acknowledged();

    const threadId = wechatMpThreadId(openId);
    const message = this.toMessage(fields, threadId, text);
    void this.chat.processMessage(this, threadId, message, options);
    return acknowledged();
  }

  parseMessage(raw: WechatMpFields): Message<WechatMpFields> {
    return this.toMessage(raw, wechatMpThreadId(raw.FromUserName), inboundText(raw) ?? '');
  }

  private toMessage(fields: WechatMpFields, threadId: string, text: string) {
    const attachments: Attachment[] =
      fields.MsgType === 'image' && fields.PicUrl
        ? [{ mimeType: 'image/jpeg', name: 'image.jpg', type: 'image', url: fields.PicUrl }]
        : [];
    return new Message<WechatMpFields>({
      attachments,
      author: {
        fullName: '',
        isBot: false,
        isMe: false,
        userId: fields.FromUserName,
        userName: '',
      },
      formatted: parseMarkdown(text),
      // Messages carry a MsgId; WeChat sends the same one again when it retries
      id: fields.MsgId || `${fields.FromUserName}:${fields.CreateTime}`,
      metadata: { dateSent: new Date(Number(fields.CreateTime) * 1000), edited: false },
      raw: fields,
      text,
      threadId,
    });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<WechatMpFields>> {
    const openId = openIdOfThread(threadId);
    const text = plainTextOf(message).trim();
    if (text) await this.api.sendText(openId, text);

    for (const image of await imagesOf(message)) {
      try {
        await this.api.sendImage(openId, image);
      } catch (error) {
        this.logger?.warn('Failed to send an image to WeChat: %s', error);
      }
    }

    return {
      id: `wechatmp_${Date.now()}`,
      raw: { Content: text, MsgType: 'text', ToUserName: openId },
      threadId,
    };
  }

  /** WeChat cannot edit a sent message; the bridge posts fresh replies instead of editing. */
  async editMessage(threadId: string, _messageId: string, message: AdapterPostableMessage) {
    return this.postMessage(threadId, message);
  }

  async deleteMessage(): Promise<void> {}

  async addReaction(_threadId: string, _messageId: string, _emoji: EmojiValue | string) {}

  async removeReaction(_threadId: string, _messageId: string, _emoji: EmojiValue | string) {}

  async startTyping(threadId: string): Promise<void> {
    try {
      await this.api.typing(openIdOfThread(threadId));
    } catch (error) {
      // Typing is a courtesy: past the 48-hour window WeChat refuses it
      this.logger?.debug('typing not shown: %s', error);
    }
  }

  async fetchMessages(): Promise<FetchResult<WechatMpFields>> {
    return { messages: [], nextCursor: undefined };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    return { channelId: threadId, id: threadId, isDM: true, metadata: {} };
  }

  async openDM(openId: string): Promise<string> {
    return wechatMpThreadId(openId);
  }

  encodeThreadId(openId: string): string {
    return wechatMpThreadId(openId);
  }

  decodeThreadId(threadId: string): string {
    return openIdOfThread(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  isDM(): boolean {
    return true;
  }

  renderFormatted(content: FormattedContent): string {
    return stripMarkdown(stringifyMarkdown(content));
  }
}
