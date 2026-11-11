import { BRANDING_NAME } from '@lobechat/business-const';
import debug from 'debug';

import { getMessengerLarkConfig } from '@/config/messenger';
import { appEnv } from '@/envs/app';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { createLarkStoreAppClient } from '@/server/services/bot/platforms/feishu/client';

import { getInstallationStore } from '../../installations';
import type { InstallationCredentials } from '../../installations/types';
import { issueLinkToken } from '../../linkTokenStore';
import type { MessengerPlatformBinder, UnlinkedMessageContext } from '../../types';
import { larkTenantApi } from './tenant';
import { getLarkTenantAccessToken } from './tokens';

const log = debug('lobe-server:messenger:lark');

export const buildLarkVerifyUrl = (params: {
  appUrl: string;
  platformUserId: string;
  randomId: string;
}): string => {
  const url = new URL('/verify-im', params.appUrl);
  url.searchParams.set('im_type', 'lark');
  url.searchParams.set('im_user_id', params.platformUserId);
  url.searchParams.set('random_id', params.randomId);
  url.searchParams.set('utm_source', 'messenger_lark');
  return url.toString();
};

/**
 * One tenant's install of the Lark store app. Every call carries that tenant's token, and anything
 * private to one person (the account link, command replies in a group) goes to them alone by
 * their `open_id` rather than into the chat.
 */
export class MessengerLarkBinder implements MessengerPlatformBinder {
  constructor(private readonly creds?: InstallationCredentials) {}

  async createClient(): Promise<PlatformClient | null> {
    const config = await getMessengerLarkConfig();
    if (!config || !this.creds) return null;
    const tenantKey = this.creds.tenantId;
    return createLarkStoreAppClient(
      {
        applicationId: config.appId,
        credentials: {
          appSecret: config.appSecret,
          encryptKey: config.encryptKey ?? '',
          verificationToken: config.verificationToken,
        },
        platform: 'lark',
        settings: {},
      },
      () => getLarkTenantAccessToken(config, tenantKey),
    );
  }

  async handleUnlinkedMessage(ctx: UnlinkedMessageContext): Promise<void> {
    const appUrl = appEnv.APP_URL;
    if (!appUrl || !this.creds) {
      log('handleUnlinkedMessage: missing APP_URL or install');
      return;
    }

    let randomId: string;
    try {
      randomId = await issueLinkToken({
        platform: 'lark',
        platformUserId: ctx.authorUserId,
        platformUsername: ctx.authorUserName,
        tenantId: this.creds.tenantId,
        tenantName: String(this.creds.metadata?.tenantName ?? '') || undefined,
      });
    } catch (error) {
      log('handleUnlinkedMessage: failed to issue link token: %O', error);
      await this.sendPrivately(
        ctx.authorUserId,
        `${BRANDING_NAME} is temporarily unavailable. Please try again in a moment.`,
      );
      return;
    }

    const verifyUrl = buildLarkVerifyUrl({
      appUrl,
      platformUserId: ctx.authorUserId,
      randomId,
    });
    await this.sendPrivately(
      ctx.authorUserId,
      `Welcome to ${BRANDING_NAME}!\n\nTo continue, link your Lark account to ${BRANDING_NAME}. The link expires in 30 minutes:\n\n${verifyUrl}\n\nAfter linking, send /agents anytime to see your agents and switch between them.`,
    );
  }

  async notifyLinkSuccess(params: {
    activeAgentName?: string;
    platformUserId: string;
    tenantId?: string;
  }): Promise<void> {
    let creds = this.creds;
    if (!creds && params.tenantId) {
      creds =
        (await getInstallationStore('lark')?.resolveByKey(`lark:${params.tenantId}`)) ?? undefined;
    }
    if (!creds) {
      log('notifyLinkSuccess: no install for tenant=%s', params.tenantId);
      return;
    }

    const tail = params.activeAgentName
      ? `\n\nActive agent: ${params.activeAgentName}\n\nSend your first message now, or /agents anytime to switch.`
      : '\n\nSend /agents to see your agents and pick one.';
    await new MessengerLarkBinder(creds).sendPrivately(
      params.platformUserId,
      `Linked. Your ${BRANDING_NAME} account is now connected.${tail}`,
    );
  }

  /** Lark has no ephemeral text, so a private reply to a group mention goes to the person's DM. */
  async replyEphemeral(params: { channelId: string; text: string; userId: string }) {
    await this.sendPrivately(params.userId, params.text);
  }

  async sendDmText(chatId: string, text: string): Promise<void> {
    const config = await getMessengerLarkConfig();
    if (!config || !this.creds) return;
    try {
      await larkTenantApi(config, this.creds.tenantId).sendMessage(chatId, text);
    } catch (error) {
      log('sendDmText: failed for chat=%s: %O', chatId, error);
    }
  }

  private async sendPrivately(openId: string, text: string): Promise<void> {
    const config = await getMessengerLarkConfig();
    if (!config || !this.creds) return;
    try {
      await larkTenantApi(config, this.creds.tenantId).sendMessageToUser(openId, text);
    } catch (error) {
      log('sendPrivately: failed for user=%s: %O', openId, error);
    }
  }
}
