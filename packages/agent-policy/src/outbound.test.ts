import { describe, expect, it } from 'vitest';

import { findSecrets, maskSecrets, REDACTED } from './outbound';

describe('findSecrets', () => {
  it.each([
    ['an OpenAI key', { body: 'use sk-proj-abcdefghijklmnopqrstuvwx1234' }, 'api_key'],
    ['an AWS key id', { note: 'AKIAIOSFODNN7EXAMPLE' }, 'api_key'],
    ['a GitHub token', { text: 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789' }, 'api_key'],
    ['a key in a key field', { api_key: 'anything at all' }, 'api_key'],
    [
      'a password stated in English',
      { body: 'Your password is hunter22, keep it safe' },
      'password',
    ],
    ['a password stated in Chinese', { body: '邮箱密码：Abc12345，别告诉别人' }, 'password'],
    ['a password field', { username: 'ada', password: 'correct horse' }, 'password'],
    ['a Visa number with spaces', { body: 'card 4111 1111 1111 1111 exp 12/30' }, 'card_number'],
    ['a UnionPay number', { body: '6222020200112345679' }, 'card_number'],
    ['a mainland ID number', { body: '身份证 11010519491231002X' }, 'id_number'],
    ['a US SSN', { body: 'SSN 123-45-6789' }, 'id_number'],
    [
      'a private key',
      {
        file: '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA\n-----END OPENSSH PRIVATE KEY-----',
      },
      'private_key',
    ],
  ])('finds %s', (_name, args, kind) => {
    expect(findSecrets(args)).toEqual([kind]);
  });

  it.each([
    ['a millisecond timestamp', { at: '1795036257883' }],
    ['an order number', { order: '20261118123456789012' }],
    ['a number that fails the card check', { body: '4111 1111 1111 1112' }],
    ['an ID-shaped number with a wrong check digit', { body: '110105194912310021' }],
    ['a phone number', { to: '+86 138 0013 8000' }],
    ['a page token', { pageToken: 'CAUQAA', query: 'invoices' }],
    ['talk about passwords', { body: 'Reset your password from the settings page.' }],
  ])('ignores %s', (_name, args) => {
    expect(findSecrets(args)).toEqual([]);
  });

  it('looks inside nested arguments and reports each kind once', () => {
    expect(
      findSecrets({
        recipients: [{ email: 'a@example.com' }],
        sections: [{ text: 'password: s3cretpw' }, { text: 'pwd=another1' }],
        token: { api_key: 'k' },
      }),
    ).toEqual(['api_key', 'password']);
  });
});

describe('maskSecrets', () => {
  it('keeps dates and other values that are not plain data as they are', () => {
    const createdAt = new Date('2026-11-18T08:00:00Z');
    const [message] = maskSecrets([{ content: 'my pwd is hunter22', createdAt, index: 3 }]);

    expect(message.createdAt).toBe(createdAt);
    expect(message).toEqual({ content: `my ${REDACTED}`, createdAt, index: 3 });
  });

  it('replaces secrets and keeps everything else', () => {
    expect(
      maskSecrets({
        password: 'hunter22',
        subject: 'Card 4111111111111111 for the booking',
        to: 'ada@example.com',
      }),
    ).toEqual({
      password: REDACTED,
      subject: `Card ${REDACTED} for the booking`,
      to: 'ada@example.com',
    });
  });
});
