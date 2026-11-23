import { isMainlandRegion } from '@lobechat/region';

import { regionEnv } from '@/envs/region';
import { type BotReplyLocale, getBotReplyLocale } from '@/server/services/bot/platforms/const';

/**
 * The language the shared bots answer in. The mainland edition answers in Chinese everywhere; the
 * international edition follows the platform's audience (Feishu and WeChat in Chinese, the others
 * in English).
 */
export const messengerReplyLocale = (platform: string | undefined): BotReplyLocale =>
  // The WeChat Official Account's followers read Chinese wherever the server runs
  isMainlandRegion(regionEnv.APP_REGION) || platform === 'wechatmp'
    ? 'zh-CN'
    : getBotReplyLocale(platform);

/** Replies only Biber's shared bots send; the command replies live in `systemReply.ts`. */
interface MessengerReplies {
  linked: (activeAgentName?: string) => string;
  linkInvite: (platformName: string, url: string) => string;
  multipleHumans: string;
  temporarilyUnavailable: string;
}

const REPLIES: Record<'en-US' | 'zh-CN', MessengerReplies> = {
  'en-US': {
    linkInvite: (platformName, url) =>
      `Welcome to Biber!\n\nTo continue, link your ${platformName} account to Biber. The link expires in 30 minutes:\n\n${url}\n\nAfter linking, send /agents anytime to see your agents and switch between them.`,
    linked: (activeAgentName) =>
      activeAgentName
        ? `Linked. Your Biber account is now connected.\n\nActive agent: ${activeAgentName}\n\nSend your first message now, or /agents anytime to switch.`
        : 'Linked. Your Biber account is now connected.\n\nSend /agents to see your agents and pick one.',
    multipleHumans:
      "Multiple people are talking in this thread now. From here on I'll only respond when you @mention me.",
    temporarilyUnavailable: 'Biber is temporarily unavailable. Please try again in a moment.',
  },
  'zh-CN': {
    linkInvite: (platformName, url) =>
      `欢迎使用 Biber！\n\n请先把你的${platformName}账号绑定到 Biber，链接 30 分钟内有效：\n\n${url}\n\n绑定后随时发送 /agents 查看并切换你的助理。`,
    linked: (activeAgentName) =>
      activeAgentName
        ? `绑定成功，你的 Biber 账号已连接。\n\n当前助理：${activeAgentName}\n\n现在就可以发消息了，发送 /agents 可以随时切换。`
        : '绑定成功，你的 Biber 账号已连接。\n\n发送 /agents 查看并选择一个助理。',
    multipleHumans: '这个对话里现在有好几个人在说话。之后只有 @我 时我才会回复。',
    temporarilyUnavailable: 'Biber 暂时不可用，请稍后再试。',
  },
};

/** Biber's own shared-bot replies (link invite, linked, crowded thread) in the language for `platform`. */
export const messengerReplies = (platform: string | undefined): MessengerReplies => {
  const locale = messengerReplyLocale(platform);
  return locale === 'zh-CN' ? REPLIES['zh-CN'] : REPLIES['en-US'];
};
