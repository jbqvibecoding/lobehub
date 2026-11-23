// @vitest-environment node
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  answerUrlCheck,
  decryptFromWechat,
  encryptForWechat,
  readDelivery,
  readWechatXml,
  wechatSignature,
} from '../protocol';
import { encryptedDelivery, SECRETS, textMessage, xml } from './fixtures';

const plainDelivery = (fields: Record<string, string>, token = SECRETS.token) => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const url = new URL('https://app.biber.test/hook');
  url.searchParams.set('signature', wechatSignature(token, timestamp, 'n1'));
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('nonce', 'n1');
  return { body: xml(fields), url };
};

describe('signatures', () => {
  it('signs the sorted parts with SHA-1, as WeChat does', () => {
    expect(wechatSignature('b', 'c', 'a')).toBe(createHash('sha1').update('abc').digest('hex'));
  });

  it("answers WeChat's URL check only when it is signed with our token", () => {
    const url = new URL('https://app.biber.test/hook?timestamp=1&nonce=2&echostr=hello');
    url.searchParams.set('signature', wechatSignature(SECRETS.token, '1', '2'));
    expect(answerUrlCheck(SECRETS, url)).toBe('hello');

    url.searchParams.set('signature', wechatSignature('other-token', '1', '2'));
    expect(answerUrlCheck(SECRETS, url)).toBeUndefined();
  });
});

describe('safe-mode encryption', () => {
  it('round-trips a message, Chinese text included', () => {
    const message = xml({ Content: '你好，世界' });
    expect(decryptFromWechat(SECRETS, encryptForWechat(SECRETS, message))).toBe(message);
  });

  it('refuses a message encrypted for another account, or garbage', () => {
    const forOther = encryptForWechat({ ...SECRETS, appId: 'wxother' }, '<xml></xml>');
    expect(() => decryptFromWechat(SECRETS, forOther)).toThrow('another account');
    expect(() => decryptFromWechat(SECRETS, 'bm90IGVuY3J5cHRlZA==')).toThrow('does not decrypt');
  });
});

describe('reading a delivery', () => {
  it('verifies and decrypts a safe-mode message', () => {
    const { body, url } = encryptedDelivery(textMessage('帮我看看日程'));

    expect(readDelivery(SECRETS, url, body)).toMatchObject({
      Content: '帮我看看日程',
      FromUserName: 'oUser1',
      MsgType: 'text',
    });
  });

  it('refuses a safe-mode message whose body was swapped', () => {
    const { url } = encryptedDelivery(textMessage('hello'));
    const { body: other } = encryptedDelivery(textMessage('transfer everything'));

    expect(() => readDelivery(SECRETS, url, other)).toThrow('does not match');
  });

  it('refuses a stale, unsigned, or plain delivery when messages should be encrypted', () => {
    const stale = encryptedDelivery(textMessage('hi'), {
      timestamp: String(Math.floor(Date.now() / 1000) - 3600),
    });
    expect(() => readDelivery(SECRETS, stale.url, stale.body)).toThrow('expired');

    const unsigned = encryptedDelivery(textMessage('hi'));
    unsigned.url.searchParams.set('signature', 'x');
    expect(() => readDelivery(SECRETS, unsigned.url, unsigned.body)).toThrow('does not match');

    const plain = plainDelivery(textMessage('hi'));
    expect(() => readDelivery(SECRETS, plain.url, plain.body)).toThrow('not encrypted');
  });

  it('reads plain deliveries when the account does not encrypt', () => {
    const { body, url } = plainDelivery(textMessage('hi'));
    const plainSecrets = { appId: SECRETS.appId, token: SECRETS.token };

    expect(readDelivery(plainSecrets, url, body)).toMatchObject({ Content: 'hi' });
  });
});

describe('XML', () => {
  it('reads CDATA and plain text fields and skips nested elements', () => {
    expect(
      readWechatXml(
        '<xml><ToUserName><![CDATA[gh_1]]></ToUserName><CreateTime>1348831860</CreateTime>' +
          '<Content><![CDATA[a <b> & c]]></Content><ScanCodeInfo><ScanType>qrcode</ScanType></ScanCodeInfo></xml>',
      ),
    ).toEqual({ Content: 'a <b> & c', CreateTime: '1348831860', ToUserName: 'gh_1' });
    expect(() => readWechatXml('{"json": true}')).toThrow('not WeChat XML');
  });
});
