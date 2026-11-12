import debug from 'debug';

import { getMessengerWechatConfig } from '@/config/messenger';

import { expiringCache } from '../../expiringCache';
import type { MessengerPlatformWebhookGate } from '../types';
import { inboundText } from './adapter';
import { MessengerWechatBinder } from './binder';
import { answerUrlCheck, readDelivery, WechatMpVerificationError } from './protocol';

const log = debug('lobe-server:messenger:wechat:webhook');

/** WeChat stops retrying a delivery once it gets this reply. */
const acknowledged = () => new Response('success', { status: 200 });

/** WeChat retries a delivery it got no answer to; a welcome is sent once per event. */
const EVENT_DEDUPE_SECONDS = 10 * 60;

/**
 * What the shared Official Account handles before messages reach the Chat SDK: WeChat's check of
 * the server URL, follow and QR-scan events (answered with a welcome or the link to connect), and
 * kinds of message the bot cannot read yet. Deliveries WeChat did not sign are refused here.
 */
export const wechatWebhookGate: MessengerPlatformWebhookGate = {
  handleGet: async (req) => {
    const config = await getMessengerWechatConfig();
    if (!config) return new Response('WeChat is not configured', { status: 503 });

    const echostr = answerUrlCheck(config, new URL(req.url));
    return echostr
      ? new Response(echostr, { headers: { 'Content-Type': 'text/plain' } })
      : new Response('signature does not match', { status: 401 });
  },

  preprocess: async (req, rawBody) => {
    const config = await getMessengerWechatConfig();
    if (!config) return null;

    let fields;
    try {
      fields = readDelivery(config, new URL(req.url), rawBody);
    } catch (error) {
      if (error instanceof WechatMpVerificationError) {
        log('refused a delivery: %s', error.message);
        return new Response(error.message, { status: 401 });
      }
      throw error;
    }

    const openId = fields.FromUserName;
    if (!openId) return acknowledged();
    const binder = new MessengerWechatBinder();

    if (fields.MsgType === 'event') {
      const event = fields.Event;
      // `subscribe` is a new follower (possibly from the QR code); `SCAN` a follower who scanned it
      if (event !== 'subscribe' && event !== 'SCAN') return acknowledged();

      const first = await expiringCache.claim(
        `messenger:wechat:event:${openId}:${fields.CreateTime}:${event}`,
        EVENT_DEDUPE_SECONDS,
      );
      if (first) await binder.greet(openId);
      return acknowledged();
    }

    if (inboundText(fields) === undefined) {
      const first = await expiringCache.claim(
        `messenger:wechat:unsupported:${openId}:${fields.MsgId ?? fields.CreateTime}`,
        EVENT_DEDUPE_SECONDS,
      );
      if (first) await binder.sendDmText(openId, '目前只能处理文字和图片消息，请发送文字。');
      return acknowledged();
    }

    return null;
  },
};
