import { describe, expect, it } from 'vitest';

import { HIDDEN, maskMailSecrets, maskMailSecretsIn } from './inbound';

describe('maskMailSecrets', () => {
  it.each([
    ['a Chinese code after the word', '【某银行】您的验证码是482913，5分钟内有效。', '482913'],
    ['a Chinese code with a colon', '登录验证码：731205，请勿告诉他人', '731205'],
    ['a Chinese dynamic password', '动态密码 9031 用于本次支付', '9031'],
    ['an English code after "is"', 'Your verification code is 482913.', '482913'],
    ['an English code with a colon', 'Security code: 55-1208 (expires soon)', '55-1208'],
    ['a code before the words', '482913 is your Instagram code. Do not share it.', '482913'],
    ['a code before Chinese words', '482913（登录验证码）请于10分钟内输入', '482913'],
    ['a letter and digit code', 'Your one-time code: G7K2Q9', 'G7K2Q9'],
    ['an OTP', 'OTP 120934 for your transfer', '120934'],
    ['a spaced code', 'Your code is 482 913', '482 913'],
  ])('hides %s', (_name, text, code) => {
    const masked = maskMailSecrets(text);

    expect(masked).not.toContain(code);
    expect(masked).toContain(HIDDEN);
  });

  it.each([
    [
      'a reset link',
      'Reset it here: https://accounts.example.com/reset-password?token=Zx81kQ0pLm2Vb7Ty',
    ],
    [
      'a magic sign-in link',
      'Sign in: https://app.example.com/auth/magic/aGVsbG8td29ybGQtMTIzNDU2',
    ],
    [
      'a confirm link in Chinese mail',
      '点击确认邮箱：https://mail.example.cn/verify?code=7c1f9e2a6b44d0aa&uid=88',
    ],
    ['a link with a signed key', 'https://example.com/login?key=9f8e7d6c5b4a39281706f5e4'],
  ])('hides %s', (_name, text) => {
    const masked = maskMailSecrets(text);

    expect(masked).not.toMatch(/https?:\/\//);
    expect(masked).toContain(HIDDEN);
  });

  it.each([
    ['an order number', '订单号 2026112100123 已发货'],
    ['a phone number', '有问题请致电 13800138000'],
    ['a date and a time', 'The meeting moved to 2026-11-23 at 15:30'],
    ['a code of conduct year', 'Read our code of conduct 2026 edition'],
    ['a plain link', 'Agenda: https://example.com/events/2026/annual-meetup'],
    ['a reset guide without a token', 'See https://support.example.com/how-to-reset-your-router'],
    ['a price', 'Total 1,280.00 元，验货后付款'],
  ])('leaves %s alone', (_name, text) => {
    expect(maskMailSecrets(text)).toBe(text);
  });

  it('hides secrets anywhere in a tool result, keeping its shape', () => {
    const result = {
      messages: [
        { from: 'bank@example.com', snippet: '您的验证码是482913', subject: '登录提醒' },
        { from: 'ana@example.com', snippet: 'See you at 15:30', subject: 'Lunch' },
      ],
      nextPageToken: 'CAESBggBEAEYAQ',
      total: 2,
    };

    const masked = maskMailSecretsIn(result);

    expect(masked.messages[0].snippet).toBe(`您的验证码是${HIDDEN}`);
    expect(masked.messages[1]).toEqual(result.messages[1]);
    expect(masked.nextPageToken).toBe(result.nextPageToken);
    expect(masked.total).toBe(2);
  });

  it('hides secrets inside a JSON string, as Composio returns it', () => {
    const raw = JSON.stringify({ body: 'Your verification code is 482913' });

    expect(maskMailSecretsIn(raw)).not.toContain('482913');
  });
});
