import { timingSafeEqual } from 'node:crypto';

import debug from 'debug';

import { getMessengerTelegramConfig } from '@/config/messenger';

import type { MessengerPlatformWebhookGate } from '../types';

const log = debug('lobe-server:messenger:telegram:webhook');

const sameText = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Telegram sends the webhook's secret token with every update. Button taps (agent and scope
 * pickers, approve / reject) are read from the raw update before the Chat SDK adapter runs its own
 * check, so the token is checked here first: without it, anyone could post a tap in a linked
 * user's name. A bot stored without a secret has nothing to check against; `ops.ts doctor` flags it.
 */
export const telegramWebhookGate: MessengerPlatformWebhookGate = {
  preprocess: async (req) => {
    const config = await getMessengerTelegramConfig();
    if (!config?.webhookSecret) return null;

    const given = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
    if (sameText(given, config.webhookSecret)) return null;

    log('refused an update without the webhook secret');
    return new Response('Invalid secret token', { status: 401 });
  },
};
