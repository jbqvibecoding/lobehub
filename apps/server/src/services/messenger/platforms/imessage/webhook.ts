import debug from 'debug';

import type { MessengerPlatformWebhookGate } from '../types';

const log = debug('lobe-server:messenger:imessage:webhook');

/**
 * The shared line answers one-to-one chats only. A group thread would let everyone in it read the
 * linked owner's replies, and Linq group chats have no mention to tell who the bot is answering.
 *
 * Group messages are acknowledged without being verified or read further: nothing runs for them,
 * and a 200 stops Linq retrying. Everything else goes on to the adapter, which checks the signature.
 */
export const imessageWebhookGate: MessengerPlatformWebhookGate = {
  preprocess: async (_req, rawBody) => {
    let event: { data?: { chat?: { is_group?: boolean } }; event_type?: string };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return null;
    }

    if (event?.data?.chat?.is_group === true) {
      log('ignoring a group chat event (%s)', event.event_type);
      return new Response('OK', { status: 200 });
    }
    return null;
  },
};
