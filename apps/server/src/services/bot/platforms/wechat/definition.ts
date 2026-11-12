import { channelDocUrl } from '@lobechat/const';

import type { PlatformDefinition } from '../types';
import { WechatClientFactory } from './client';
import { schema } from './schema';

export const wechat: PlatformDefinition = {
  id: 'wechat',
  name: 'WeChat',
  connectionMode: 'polling',
  description: 'Connect a WeChat bot via iLink API',
  documentation: {
    setupGuideUrl: channelDocUrl('wechat'),
  },
  schema,
  // WeChat shows markdown markers as typed, so the agent is told to write plain text
  supportsMarkdown: false,
  supportsMessageEdit: false,
  clientFactory: new WechatClientFactory(),
};
