import { howToLink } from './describe-chat-app';

describe('howToLink', () => {
  it('opens the bot in Telegram', () => {
    expect(
      howToLink({ botUsername: 'BiberBot', id: 'telegram', name: 'Telegram' }, 'ios').open,
    ).toEqual({ label: 'Open Telegram', url: 'https://t.me/BiberBot' });
  });

  it('texts the shared iMessage line from an iPhone only', () => {
    const imessage = { id: 'imessage', name: 'iMessage', phoneNumber: '+15550100' };
    expect(howToLink(imessage, 'ios')).toEqual({
      hint: '+15550100',
      open: { label: 'Open iMessage', url: 'sms:+15550100' },
    });
    expect(howToLink(imessage, 'android').open).toBeUndefined();
  });

  it('sends Lark users to the install page, with what to do after it', () => {
    const steps = howToLink(
      { id: 'lark', installUrl: 'https://lark.example/install', name: 'Lark' },
      'ios',
    );
    expect(steps.open?.url).toBe('https://lark.example/install');
    expect(steps.hint).toContain('Lark');
  });

  it('points to the web for chat apps linked from there', () => {
    expect(howToLink({ id: 'slack', name: 'Slack' }, 'ios')).toEqual({
      hint: 'Link it from Biber on the web.',
    });
  });
});
