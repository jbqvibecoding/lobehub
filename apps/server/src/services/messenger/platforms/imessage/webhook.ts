import debug from 'debug';

import type { MessengerPlatformWebhookGate } from '../types';

const log = debug('lobe-server:messenger:imessage:webhook');

/**
 * The shared line answers one-to-one iMessage chats only. A group thread would let everyone in it read the
 * linked owner's replies, and Linq group chats have no mention to tell who the bot is answering.
 *
 * Group messages and messages sent as SMS or RCS are acknowledged without being verified or read
 * further: nothing runs for them, and a 200 stops Linq retrying. Everything else goes on to the
 * adapter, which checks the signature.
 */
export const imessageWebhookGate: MessengerPlatformWebhookGate = {
  preprocess: async (_req, rawBody) => {
    let event: {
      data?: { chat?: { is_group?: boolean }; sender_handle?: { service?: string } };
      event_type?: string;
    };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return null;
    }

    if (event?.data?.chat?.is_group === true) {
      log('ignoring a group chat event (%s)', event.event_type);
      return new Response('OK', { status: 200 });
    }
    // A user is known by their number, so a message must prove it comes from that number. Apple
    // authenticates the sender of an iMessage; a text message's sender number can be forged.
    if (
      event?.event_type === 'message.received' &&
      event.data?.sender_handle?.service !== 'iMessage'
    ) {
      log('ignoring a message sent by %s', event.data?.sender_handle?.service ?? 'unknown service');
      return new Response('OK', { status: 200 });
    }
    return null;
  },
};
