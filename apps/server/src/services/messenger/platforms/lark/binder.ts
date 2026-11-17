import debug from 'debug';

import { getLarkFamilyConfig, type MessengerLarkConfig } from '@/config/messenger';
import { appEnv } from '@/envs/app';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { createLarkStoreAppClient } from '@/server/services/bot/platforms/feishu/client';

import { getInstallationStore } from '../../installations';
import type { InstallationCredentials } from '../../installations/types';
import { issueLinkToken } from '../../linkTokenStore';
import { messengerReplies } from '../../replies';
import type {
  CallbackAcknowledgement,
  InboundCallbackAction,
  MessengerPlatformBinder,
  UnlinkedMessageContext,
} from '../../types';
import { buildAnsweredCard, buildApprovalCard, readCardAction, sendLarkCard } from './approvalCard';
import { readLarkEvent } from './events';
import { larkTenantApi } from './tenant';
import { getLarkTenantAccessToken } from './tokens';

const log = debug('lobe-server:messenger:lark');

type LarkPlatform = MessengerLarkConfig['platform'];

/** How the platform is named in its own replies: Feishu speaks Chinese in both editions. */
const PLATFORM_NAMES: Record<LarkPlatform, string> = { feishu: '飞书', lark: 'Lark' };

export const buildLarkVerifyUrl = (params: {
  appUrl: string;
  platform: LarkPlatform;
  platformUserId: string;
  randomId: string;
}): string => {
  const url = new URL('/verify-im', params.appUrl);
  url.searchParams.set('im_type', params.platform);
  url.searchParams.set('im_user_id', params.platformUserId);
  url.searchParams.set('random_id', params.randomId);
  url.searchParams.set('utm_source', `messenger_${params.platform}`);
  return url.toString();
};

/**
 * One tenant's install of the Lark or Feishu store app. Every call carries that tenant's token, and anything
 * private to one person (the account link, command replies in a group) goes to them alone by
 * their `open_id` rather than into the chat.
 */
export class MessengerLarkBinder implements MessengerPlatformBinder {
  constructor(
    private readonly platform: LarkPlatform,
    private readonly creds?: InstallationCredentials,
  ) {}

  async createClient(): Promise<PlatformClient | null> {
    const config = await getLarkFamilyConfig(this.platform);
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
        platform: this.platform,
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
        platform: this.platform,
        platformUserId: ctx.authorUserId,
        platformUsername: ctx.authorUserName,
        tenantId: this.creds.tenantId,
        tenantName: String(this.creds.metadata?.tenantName ?? '') || undefined,
      });
    } catch (error) {
      log('handleUnlinkedMessage: failed to issue link token: %O', error);
      await this.sendPrivately(
        ctx.authorUserId,
        messengerReplies(this.platform).temporarilyUnavailable,
      );
      return;
    }

    const verifyUrl = buildLarkVerifyUrl({
      appUrl,
      platform: this.platform,
      platformUserId: ctx.authorUserId,
      randomId,
    });
    await this.sendPrivately(
      ctx.authorUserId,
      messengerReplies(this.platform).linkInvite(PLATFORM_NAMES[this.platform], verifyUrl),
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
        (await getInstallationStore(this.platform)?.resolveByKey(
          `${this.platform}:${params.tenantId}`,
        )) ?? undefined;
    }
    if (!creds) {
      log('notifyLinkSuccess: no install for tenant=%s', params.tenantId);
      return;
    }

    await new MessengerLarkBinder(this.platform, creds).sendPrivately(
      params.platformUserId,
      messengerReplies(this.platform).linked(params.activeAgentName),
    );
  }

  /**
   * Answers a tap within Lark's three seconds: the toast shows above the card, and the card is
   * replaced by its outcome (no buttons left) through the callback's own reply.
   */
  async acknowledgeCallback(
    _action: InboundCallbackAction,
    ack: CallbackAcknowledgement,
  ): Promise<Response> {
    return Response.json({
      ...(ack.replaceText && { card: { data: buildAnsweredCard(ack.replaceText), type: 'raw' } }),
      ...(ack.toast && { toast: { content: ack.toast, type: 'info' } }),
    });
  }

  /** A tap on one of our card buttons, from an authenticated delivery; null for anything else. */
  async extractCallbackAction(req: Request): Promise<InboundCallbackAction | null> {
    const config = await getLarkFamilyConfig(this.platform);
    if (!config) return null;
    const read = readLarkEvent(req.headers, await req.text(), config);
    return read.ok ? readCardAction(read.body) : null;
  }

  /** A paused run's request as a card with Approve / Reject buttons. */
  async sendApprovalRequest(
    chatId: string,
    params: {
      approvals: { toolMessageId: string }[];
      labels: { approve: string; reject: string };
      messageId?: string;
      text: string;
    },
  ): Promise<void> {
    const config = await getLarkFamilyConfig(this.platform);
    if (!config || !this.creds) return;
    await sendLarkCard(config, this.creds.tenantId, chatId, buildApprovalCard(params));
  }

  /** Lark has no ephemeral text, so a private reply to a group mention goes to the person's DM. */
  async replyEphemeral(params: { channelId: string; text: string; userId: string }) {
    await this.sendPrivately(params.userId, params.text);
  }

  async sendDmText(chatId: string, text: string): Promise<void> {
    const config = await getLarkFamilyConfig(this.platform);
    if (!config || !this.creds) return;
    try {
      await larkTenantApi(config, this.creds.tenantId).sendMessage(chatId, text);
    } catch (error) {
      log('sendDmText: failed for chat=%s: %O', chatId, error);
    }
  }

  private async sendPrivately(openId: string, text: string): Promise<void> {
    const config = await getLarkFamilyConfig(this.platform);
    if (!config || !this.creds) return;
    try {
      await larkTenantApi(config, this.creds.tenantId).sendMessageToUser(openId, text);
    } catch (error) {
      log('sendPrivately: failed for user=%s: %O', openId, error);
    }
  }
}
