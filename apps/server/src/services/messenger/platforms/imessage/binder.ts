import { BRANDING_NAME } from '@lobechat/business-const';
import debug from 'debug';

import { getMessengerImessageConfig } from '@/config/messenger';
import { appEnv } from '@/envs/app';

import { issueLinkToken } from '../../linkTokenStore';
import type { MessengerPlatformBinder, UnlinkedMessageContext } from '../../types';
import { LinqImessageClient, linqThreadId } from './client';

const log = debug('lobe-server:messenger:imessage');

export const buildImessageVerifyUrl = (params: {
  appUrl: string;
  platformUserId: string;
  randomId: string;
}): string => {
  const url = new URL('/verify-im', params.appUrl);
  url.searchParams.set('im_type', 'imessage');
  url.searchParams.set('im_user_id', params.platformUserId);
  url.searchParams.set('random_id', params.randomId);
  url.searchParams.set('utm_source', 'messenger_imessage');
  return url.toString();
};

/**
 * The shared iMessage line. iMessage has no buttons, so every prompt is plain text: the link step
 * sends the verify URL on its own line (iMessage turns it into a tappable preview), agent switching
 * uses the numbered `/agents <n>` reply, and approvals point to the app.
 */
export class MessengerImessageBinder implements MessengerPlatformBinder {
  async createClient(): Promise<LinqImessageClient | null> {
    const config = await getMessengerImessageConfig();
    if (!config) return null;
    return new LinqImessageClient({ apiKey: config.apiKey, signingSecret: config.signingSecret });
  }

  async handleUnlinkedMessage(ctx: UnlinkedMessageContext): Promise<void> {
    const appUrl = appEnv.APP_URL;
    if (!appUrl) {
      log('handleUnlinkedMessage: APP_URL not set, cannot build the link');
      return;
    }

    let randomId: string;
    try {
      randomId = await issueLinkToken({
        platform: 'imessage',
        platformUserId: ctx.authorUserId,
        platformUsername: ctx.authorUserName,
      });
    } catch (error) {
      log('handleUnlinkedMessage: failed to issue link token: %O', error);
      await this.sendDmText(
        ctx.chatId,
        `${BRANDING_NAME} is temporarily unavailable. Please try again in a moment.`,
      );
      return;
    }

    const verifyUrl = buildImessageVerifyUrl({
      appUrl,
      platformUserId: ctx.authorUserId,
      randomId,
    });

    await this.sendDmText(
      ctx.chatId,
      `Welcome to ${BRANDING_NAME}!\n\nTo continue, link this number to your ${BRANDING_NAME} account. The link expires in 30 minutes:\n\n${verifyUrl}\n\nAfter linking, send /agents anytime to see your agents and switch between them.`,
    );
  }

  /**
   * The link confirmation goes to the person who linked, by their phone number or Apple ID email.
   * Linq reuses the existing chat with that handle rather than starting a second one.
   */
  async notifyLinkSuccess(params: {
    activeAgentName?: string;
    platformUserId: string;
    tenantId?: string;
  }): Promise<void> {
    const client = await this.createClient();
    if (!client) return;

    const tail = params.activeAgentName
      ? `\n\nActive agent: ${params.activeAgentName}\n\nSend your first message now, or /agents anytime to switch.`
      : '\n\nSend /agents to see your agents and pick one.';

    try {
      const adapter = client.outboundAdapter();
      const threadId = await adapter.openDM(params.platformUserId);
      await adapter.postMessage(
        threadId,
        `Linked. Your ${BRANDING_NAME} account is now connected.${tail}`,
      );
    } catch (error) {
      log('notifyLinkSuccess: failed to message the linked handle: %O', error);
    }
  }

  async sendDmText(chatId: string, text: string): Promise<void> {
    const client = await this.createClient();
    if (!client) return;
    try {
      await client.outboundAdapter().postMessage(linqThreadId(chatId), text);
    } catch (error) {
      log('sendDmText: failed for chat=%s: %O', chatId, error);
    }
  }
}
