import { BRANDING_NAME } from '@lobechat/business-const';
import debug from 'debug';

import { getMessengerWechatMpConfig } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { appEnv } from '@/envs/app';

import { issueLinkToken } from '../../linkTokenStore';
import type { MessengerPlatformBinder, UnlinkedMessageContext } from '../../types';
import { WechatMpClient } from './client';
import { answerWechatLinkCode, WECHAT_LINK_CODE_TTL_SECONDS } from './linkCode';

const log = debug('lobe-server:messenger:wechatmp');

export const buildWechatVerifyUrl = (params: {
  appUrl: string;
  platformUserId: string;
  randomId: string;
}): string => {
  const url = new URL('/verify-im', params.appUrl);
  url.searchParams.set('im_type', 'wechatmp');
  url.searchParams.set('im_user_id', params.platformUserId);
  url.searchParams.set('random_id', params.randomId);
  url.searchParams.set('utm_source', 'messenger_wechatmp');
  return url.toString();
};

/**
 * The shared WeChat Official Account. Its followers are mainland users, so it writes to them in
 * Chinese. WeChat has no buttons in customer-service messages: the link step sends the verify URL
 * as text (WeChat makes it tappable), agent switching uses the numbered `/agents <n>` reply, and
 * approvals are answered by replying "1" or "2".
 *
 * Linking ends in WeChat: after the confirm on the web, the follower sends the code the page shows
 * (`linkCode.ts`). Until then, their messages are read as that code.
 */
export class MessengerWechatMpBinder implements MessengerPlatformBinder {
  async createClient(): Promise<WechatMpClient | null> {
    const config = await getMessengerWechatMpConfig();
    return config ? new WechatMpClient(config) : null;
  }

  async handleUnlinkedMessage(ctx: UnlinkedMessageContext): Promise<void> {
    if (await this.answerLinkCode(ctx.authorUserId, ctx.message?.text)) return;

    const appUrl = appEnv.APP_URL;
    if (!appUrl) {
      log('handleUnlinkedMessage: APP_URL not set, cannot build the link');
      return;
    }

    let randomId: string;
    try {
      // WeChat no longer tells accounts their followers' names: the openid is all there is
      randomId = await issueLinkToken({ platform: 'wechatmp', platformUserId: ctx.authorUserId });
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

  /** Tells the follower that the web confirm went through and the code is what remains. */
  async askForLinkCode(openId: string): Promise<void> {
    await this.sendDmText(
      openId,
      `网页上已确认。请把网页上显示的 6 位数字发到这里，绑定才会生效（${WECHAT_LINK_CODE_TTL_SECONDS / 60} 分钟内有效）。如果不是你本人在网页上确认的，不用理会。`,
    );
  }

  /**
   * A follower with a link waiting for its code: the message is the code, or a reminder goes back.
   * Returns false when no link waits, and the message is handled as before.
   */
  private async answerLinkCode(openId: string, text: string | undefined): Promise<boolean> {
    const outcome = await answerWechatLinkCode(openId, text);
    switch (outcome.status) {
      case 'none': {
        return false;
      }
      case 'linked': {
        await this.notifyLinkSuccess({
          activeAgentName: outcome.activeAgentName,
          platformUserId: openId,
        });
        return true;
      }
      case 'waiting': {
        await this.sendDmText(openId, '请把网页上显示的 6 位数字发到这里，完成绑定。');
        return true;
      }
      case 'wrong': {
        await this.sendDmText(
          openId,
          `这个数字不对，请对照网页上显示的 6 位数字重新发送（还能试 ${outcome.attemptsLeft} 次）。`,
        );
        return true;
      }
      case 'tooManyAttempts': {
        await this.sendDmText(openId, '错误次数太多，这次绑定已取消。发任意消息可以重新开始。');
        return true;
      }
      case 'failed': {
        await this.sendDmText(openId, '绑定没有完成，请发任意消息重新开始。');
        return true;
      }
    }
  }

  /** Someone followed the account or scanned its QR code: welcome back, or start linking. */
  async greet(openId: string): Promise<void> {
    const link = await MessengerAccountLinkModel.findByPlatformUser(
      await getServerDB(),
      'wechatmp',
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
