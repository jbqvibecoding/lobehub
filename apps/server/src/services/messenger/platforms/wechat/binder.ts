import { BRANDING_NAME } from '@lobechat/business-const';
import debug from 'debug';

import { getMessengerWechatConfig } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { appEnv } from '@/envs/app';

import { issueLinkToken } from '../../linkTokenStore';
import type { MessengerPlatformBinder, UnlinkedMessageContext } from '../../types';
import { WechatMpClient } from './client';

const log = debug('lobe-server:messenger:wechat');

export const buildWechatVerifyUrl = (params: {
  appUrl: string;
  platformUserId: string;
  randomId: string;
}): string => {
  const url = new URL('/verify-im', params.appUrl);
  url.searchParams.set('im_type', 'wechat');
  url.searchParams.set('im_user_id', params.platformUserId);
  url.searchParams.set('random_id', params.randomId);
  url.searchParams.set('utm_source', 'messenger_wechat');
  return url.toString();
};

/**
 * The shared WeChat Official Account. Its followers are mainland users, so it writes to them in
 * Chinese. WeChat has no buttons in customer-service messages: the link step sends the verify URL
 * as text (WeChat makes it tappable), agent switching uses the numbered `/agents <n>` reply, and
 * approvals point to the app.
 */
export class MessengerWechatBinder implements MessengerPlatformBinder {
  async createClient(): Promise<WechatMpClient | null> {
    const config = await getMessengerWechatConfig();
    return config ? new WechatMpClient(config) : null;
  }

  async handleUnlinkedMessage(ctx: UnlinkedMessageContext): Promise<void> {
    const appUrl = appEnv.APP_URL;
    if (!appUrl) {
      log('handleUnlinkedMessage: APP_URL not set, cannot build the link');
      return;
    }

    let randomId: string;
    try {
      // WeChat no longer tells accounts their followers' names: the openid is all there is
      randomId = await issueLinkToken({ platform: 'wechat', platformUserId: ctx.authorUserId });
    } catch (error) {
      log('handleUnlinkedMessage: failed to issue link token: %O', error);
      await this.sendDmText(ctx.chatId, `${BRANDING_NAME} 暂时不可用，请稍后再试。`);
      return;
    }

    const verifyUrl = buildWechatVerifyUrl({
      appUrl,
      platformUserId: ctx.authorUserId,
      randomId,
    });
    await this.sendDmText(
      ctx.chatId,
      `欢迎使用 ${BRANDING_NAME}！\n\n请先把微信绑定到你的 ${BRANDING_NAME} 账号，以下链接 30 分钟内有效：\n\n${verifyUrl}\n\n绑定后直接发消息即可和助理对话，发送 /agents 可随时查看和切换助理。`,
    );
  }

  /** Someone followed the account or scanned its QR code: welcome back, or start linking. */
  async greet(openId: string): Promise<void> {
    const link = await MessengerAccountLinkModel.findByPlatformUser(
      await getServerDB(),
      'wechat',
      openId,
      '',
    );
    if (!link) {
      await this.handleUnlinkedMessage({ authorUserId: openId, chatId: openId });
      return;
    }
    await this.sendDmText(
      openId,
      `欢迎回来！直接发消息即可和助理对话，发送 /agents 可随时查看和切换助理。`,
    );
  }

  async notifyLinkSuccess(params: {
    activeAgentName?: string;
    platformUserId: string;
  }): Promise<void> {
    const tail = params.activeAgentName
      ? `\n\n当前助理：${params.activeAgentName}\n\n现在就可以发消息了，发送 /agents 可随时切换助理。`
      : '\n\n发送 /agents 查看并选择助理。';
    await this.sendDmText(
      params.platformUserId,
      `绑定成功，你的 ${BRANDING_NAME} 账号已连接。${tail}`,
    );
  }

  async sendDmText(chatId: string, text: string): Promise<void> {
    const client = await this.createClient();
    if (!client) return;
    try {
      await client.api.sendText(chatId, text);
    } catch (error) {
      log('sendDmText: failed for %s: %O', chatId, error);
    }
  }
}
