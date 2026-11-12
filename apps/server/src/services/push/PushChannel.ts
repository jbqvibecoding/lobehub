import { sleep } from '@lobechat/utils';
import debug from 'debug';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';

import { deletePushTokensOfProvider, PushTokenModel } from '@/database/models/pushToken';
import type { PushTokenItem } from '@/database/schemas';
import { serverDB } from '@/database/server';

import { DEFAULT_PUSH_CHANNEL_ID } from './constants';
import type { PushDeliveryContext, PushDeliveryResult, PushTicketRecord } from './types';
import {
  isVendorPushProvider,
  type VendorPushProvider,
  type VendorPushSender,
  vendorPushSenders,
} from './vendors';

const log = debug('lobe-notification:push');

/** Expo Push Service hard rate limit (messages per second per project) */
const SEND_CHUNK_THROTTLE_MS = 100;

/** The title and body for a phone, in the language it registered with when there is one. */
const textFor = (ctx: PushDeliveryContext, locale: string | null | undefined) =>
  (locale && ctx.translations?.[locale.split('-')[0].toLowerCase()]) || ctx;

const providerOf = (token: Pick<PushTokenItem, 'provider'>) => token.provider ?? 'expo';

/**
 * Push channel implementation backed by the Expo Push Service, and by the phone makers' own push
 * services for Android phones without Google services (mainland China).
 *
 * Structurally compatible with cloud's `NotificationChannel`; can be registered
 * directly into cloud's `channelInstances` map. Also usable standalone by
 * self-hosters who supply their own EAS credentials.
 *
 * Behaviour:
 *  1. Resolves all of `userId`'s registered Expo tokens via `PushTokenModel`
 *  2. Filters out malformed tokens via `Expo.isExpoPushToken`
 *  3. Chunks + sends with `expo.sendPushNotificationsAsync`, with throttling
 *  4. Encodes (ticketId, expoToken) pairs into `providerMessageId` so the
 *     receipt cron can identify invalid tokens later
 */
export class PushChannel {
  readonly id = 'push';

  private expo: Expo;
  private vendors?: Partial<Record<VendorPushProvider, VendorPushSender>>;

  constructor(expoClient?: Expo, vendors?: Partial<Record<VendorPushProvider, VendorPushSender>>) {
    // FCM v1 is the only supported FCM API for new projects — Legacy server
    // keys were retired by Google. APNs uses the .p8 auth key uploaded to EAS.
    // (`useFcmV1` is implicit in the current SDK; no constructor flag needed.)
    this.expo = expoClient ?? new Expo();
    this.vendors = vendors;
  }

  private vendorSenders() {
    this.vendors ??= vendorPushSenders();
    return this.vendors;
  }

  /**
   * Sends through each phone maker's push service, grouped by maker and language, and forgets the
   * tokens a maker says are gone. Returns how many phones the makers accepted the message for.
   */
  private async deliverToVendors(ctx: PushDeliveryContext, tokens: PushTokenItem[]) {
    const groups = new Map<string, { provider: VendorPushProvider; tokens: PushTokenItem[] }>();
    for (const token of tokens) {
      const provider = providerOf(token) as VendorPushProvider;
      const key = `${provider}|${token.locale?.split('-')[0].toLowerCase() ?? ''}`;
      const group = groups.get(key) ?? { provider, tokens: [] };
      group.tokens.push(token);
      groups.set(key, group);
    }

    let accepted = 0;
    for (const { provider, tokens: group } of groups.values()) {
      const sender = this.vendorSenders()[provider];
      if (!sender) continue;
      const text = textFor(ctx, group[0].locale);
      try {
        const { invalidTokens } = await sender.send(
          group.map((t) => t.expoToken),
          { body: text.content, title: text.title },
        );
        accepted += group.length - invalidTokens.length;
        if (invalidTokens.length > 0) {
          log(
            '%s reported %d gone tokens for userId=%s',
            provider,
            invalidTokens.length,
            ctx.userId,
          );
          await deletePushTokensOfProvider(serverDB, provider, invalidTokens);
        }
      } catch (error) {
        log('%s push failed for userId=%s: %O', provider, ctx.userId, error);
      }
    }
    return accepted;
  }

  async deliver(ctx: PushDeliveryContext): Promise<PushDeliveryResult> {
    const tokens = await new PushTokenModel(serverDB, ctx.userId).listByUserId();

    if (tokens.length === 0) {
      log('No push tokens for userId=%s', ctx.userId);
      return { failedReason: 'no_tokens', status: 'failed' };
    }

    // Build messages, keeping the order so we can map tickets back to tokens by index
    const validTokens = tokens.filter(
      (t) => providerOf(t) === 'expo' && Expo.isExpoPushToken(t.expoToken),
    );
    const vendorTokens = tokens.filter((t) => {
      const provider = providerOf(t);
      return isVendorPushProvider(provider) && !!this.vendorSenders()[provider];
    });
    if (validTokens.length === 0 && vendorTokens.length === 0) {
      log('All tokens malformed for userId=%s', ctx.userId);
      return { failedReason: 'invalid_tokens', status: 'failed' };
    }

    // Phone makers confirm acceptance when they answer; there are no receipts to wait for
    const vendorAccepted =
      vendorTokens.length > 0 ? await this.deliverToVendors(ctx, vendorTokens) : 0;
    if (validTokens.length === 0) {
      return vendorAccepted > 0
        ? { status: 'delivered' }
        : { failedReason: 'all_send_failed', status: 'failed' };
    }

    const messages: ExpoPushMessage[] = validTokens.map((t) => {
      const text = textFor(ctx, t.locale);

      return {
        body: text.content,
        channelId: DEFAULT_PUSH_CHANNEL_ID,
        data: {
          notificationId: ctx.notificationId,
          url: ctx.actionUrl,
        },
        priority: 'high',
        sound: 'default',
        title: text.title,
        to: t.expoToken,
      };
    });

    const ticketRecords: PushTicketRecord[] = [];
    const chunks = this.expo.chunkPushNotifications(messages);
    let cursor = 0;

    for (const chunk of chunks) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);

        tickets.forEach((ticket, i) => {
          const expoToken = chunk[i].to as string;

          if (ticket.status === 'ok') {
            ticketRecords.push({ expoToken, ticketId: ticket.id });
          } else {
            // Per-message error at send time — receipt phase won't see this one.
            // Common cases: bad token format that slipped past isExpoPushToken,
            // payload too big. Logged but not enough to fail the whole delivery.
            log(
              'Send-time error for token=%s: %s (%s)',
              expoToken,
              ticket.message,
              ticket.details?.error,
            );
          }
        });
      } catch (error) {
        const err = error as { statusCode?: number; message?: string };
        if (err.statusCode === 429) {
          log('Rate limited by Expo Push Service for userId=%s', ctx.userId);
          return vendorAccepted > 0
            ? { status: 'delivered' }
            : { failedReason: 'rate_limited', status: 'failed' };
        }
        // Unrecoverable — let the caller log via Promise.allSettled in NotificationService
        throw error;
      }

      // Throttle between chunks to stay under Expo's 600/sec project limit
      cursor += chunk.length;
      if (cursor < messages.length) {
        await sleep(SEND_CHUNK_THROTTLE_MS);
      }
    }

    if (ticketRecords.length === 0) {
      return vendorAccepted > 0
        ? { status: 'delivered' }
        : { failedReason: 'all_send_failed', status: 'failed' };
    }

    return {
      // TODO: tracking each (ticketId, expoToken) inline keeps deliveries
      // self-contained but couples PushChannel to processPushReceipts. Migrate
      // to a dedicated push_tickets table if we ever need cross-delivery joins.
      providerMessageId: JSON.stringify(ticketRecords),
      status: 'sent',
    };
  }
}
