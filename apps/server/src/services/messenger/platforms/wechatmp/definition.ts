import type { MessengerPlatformDefinition } from '../types';
import { WECHAT_MP_ADAPTER_NAME } from './adapter';
import { MessengerWechatMpBinder } from './binder';
import { wechatMpWebhookGate } from './webhook';

export const wechatmp: MessengerPlatformDefinition = {
  adapterName: WECHAT_MP_ADAPTER_NAME,
  // WeChat posts every follower's message to our webhook.
  connectionMode: 'webhook',
  createBinder: () => new MessengerWechatMpBinder(),
  id: 'wechatmp',
  name: 'WeChat',
  webhookGate: wechatMpWebhookGate,
};
