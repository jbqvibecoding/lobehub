import { describe, expect, it } from 'vitest';

import { buildLarkOpenBotUrl, isMessengerPlatform, sharedBotUrl } from './constants';

describe('sharedBotUrl', () => {
  it('opens Messages addressed to the iMessage line, whatever the number formatting', () => {
    expect(sharedBotUrl('imessage', { phoneNumber: '+1 (202) 555-0100' })).toBe('sms:+12025550100');
  });

  it('opens the Telegram bot by username', () => {
    expect(sharedBotUrl('telegram', { botUsername: '@biber_bot' })).toBe('https://t.me/biber_bot');
  });

  it('has nothing to open while the deployment has not configured the bot', () => {
    expect(sharedBotUrl('imessage', {})).toBeNull();
    expect(sharedBotUrl('telegram', {})).toBeNull();
  });
});

describe('buildLarkOpenBotUrl', () => {
  it("opens a chat with the Lark app's bot", () => {
    expect(buildLarkOpenBotUrl('cli_a1b2')).toBe(
      'https://applink.larksuite.com/client/bot/open?appId=cli_a1b2',
    );
  });
});

describe('isMessengerPlatform', () => {
  it('accepts iMessage alongside the other platforms and rejects unknown ones', () => {
    expect(isMessengerPlatform('imessage')).toBe(true);
    expect(isMessengerPlatform('lark')).toBe(true);
    expect(isMessengerPlatform('telegram')).toBe(true);
    expect(isMessengerPlatform('whatsapp')).toBe(false);
    expect(isMessengerPlatform(undefined)).toBe(false);
  });
});
