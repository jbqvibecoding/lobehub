import { type StringKey, t, tf } from '@/i18n/strings';

import type { ChatPlatform } from './types';

const LOCAL_NAMES: Partial<Record<string, StringKey>> = {
  feishu: 'platformFeishu',
  wechat: 'platformWechat',
  wechatmp: 'platformWechat',
};

export const chatAppName = (platform: Pick<ChatPlatform, 'id' | 'name'>) => {
  const key = LOCAL_NAMES[platform.id];
  return key ? t(key) : platform.name;
};

/**
 * How to start linking a chat app from the phone: the person messages the bot there, and it
 * answers with the link that finishes linking. `open` is where to send them, when the phone can.
 */
export const howToLink = (
  platform: ChatPlatform,
  os: string,
): { hint?: string; open?: { label: string; url: string } } => {
  const app = chatAppName(platform);
  const open = (url: string) => ({ label: tf('linkOpen', { app }), url });

  switch (platform.id) {
    case 'telegram': {
      return platform.botUsername ? { open: open(`https://t.me/${platform.botUsername}`) } : {};
    }
    case 'imessage': {
      // Messages on an iPhone sends to the shared line as iMessage; other phones have none
      return platform.phoneNumber && os === 'ios'
        ? { hint: platform.phoneNumber, open: open(`sms:${platform.phoneNumber}`) }
        : { hint: t('linkOnWebHint') };
    }
    // The shared WeChat Official Account: follow it, then message it
    case 'wechatmp': {
      return { hint: t('linkWechatHint'), open: open('weixin://') };
    }
    case 'feishu':
    case 'lark': {
      return {
        hint: tf('linkLarkHint', { app }),
        ...(platform.installUrl && { open: open(platform.installUrl) }),
      };
    }
    default: {
      return { hint: t('linkOnWebHint') };
    }
  }
};
