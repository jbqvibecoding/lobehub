import type { MessengerPlatformDefinition } from '../types';
import { WECHAT_MP_ADAPTER_NAME } from './adapter';
import { MessengerWechatBinder } from './binder';
import { wechatWebhookGate } from './webhook';

export const wechat: MessengerPlatformDefinition = {
  adapterName: WECHAT_MP_ADAPTER_NAME,
  // WeChat posts every follower's message to our webhook.
  connectionMode: 'webhook',
  createBinder: () => new MessengerWechatBinder(),
  id: 'wechat',
  name: 'WeChat',
  webhookGate: wechatWebhookGate,
};
