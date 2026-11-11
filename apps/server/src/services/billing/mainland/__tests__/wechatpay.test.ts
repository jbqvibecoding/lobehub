// @vitest-environment node
import { createVerify } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWechatPay, wechatTime } from '../wechatpay';
import { rsaPair, wechatEncrypt, wechatHeaders } from './keys';

const merchant = rsaPair();
const platform = rsaPair();
const API_V3_KEY = 'abcdefghijklmnopqrstuvwxyz012345';

const wechatPay = createWechatPay({
  apiV3Key: API_V3_KEY,
  appId: 'wx_app',
  merchantId: '1900000001',
  merchantSerialNo: 'SERIAL01',
  privateKey: merchant.privateKey,
  publicKey: platform.publicKey,
  publicKeyId: 'PUB_KEY_ID_TEST',
});

const notification = (transaction: object, eventType = 'TRANSACTION.SUCCESS') =>
  JSON.stringify({
    event_type: eventType,
    id: 'evt-1',
    resource: wechatEncrypt(API_V3_KEY, JSON.stringify(transaction)),
    resource_type: 'encrypt-resource',
  });

const paid = {
  amount: { currency: 'CNY', payer_total: 6800, total: 6800 },
  appid: 'wx_app',
  mchid: '1900000001',
  out_trade_no: 'order-1',
  success_time: '2026-11-11T10:30:00+08:00',
  trade_state: 'SUCCESS',
  transaction_id: '4200000001',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('placing a Native order', () => {
  it('signs the request with the merchant key and returns the QR code link', async () => {
    const responseBody = JSON.stringify({ code_url: 'weixin://wxpay/bizpayurl?pr=abc' });
    const fetchMock = vi.fn(
      async () =>
        new Response(responseBody, {
          headers: wechatHeaders(platform.privateKey, responseBody),
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const codeUrl = await wechatPay.createNativeOrder({
      amount: 6800,
      description: 'Biber 基础版（月付）',
      expiresAt: new Date('2026-11-11T02:30:00Z'),
      notifyUrl: 'https://app.biber.test/api/webhooks/wechatpay',
      outTradeNo: 'order-1',
    });

    expect(codeUrl).toBe('weixin://wxpay/bizpayurl?pr=abc');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.mch.weixin.qq.com/v3/pay/transactions/native');
    expect(JSON.parse(init.body as string)).toEqual({
      amount: { currency: 'CNY', total: 6800 },
      appid: 'wx_app',
      description: 'Biber 基础版（月付）',
      mchid: '1900000001',
      notify_url: 'https://app.biber.test/api/webhooks/wechatpay',
      out_trade_no: 'order-1',
      time_expire: '2026-11-11T10:30:00+08:00',
    });

    const auth = (init.headers as Record<string, string>).Authorization;
    const fields = Object.fromEntries(
      [...auth.matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
    );
    expect(auth.startsWith('WECHATPAY2-SHA256-RSA2048 ')).toBe(true);
    expect(fields).toMatchObject({ mchid: '1900000001', serial_no: 'SERIAL01' });
    const message = `POST\n/v3/pay/transactions/native\n${fields.timestamp}\n${fields.nonce_str}\n${init.body}\n`;
    expect(
      createVerify('RSA-SHA256')
        .update(message)
        .verify(merchant.publicKey, fields.signature, 'base64'),
    ).toBe(true);
  });

  it('refuses a response WeChat Pay did not sign', async () => {
    const body = JSON.stringify({ code_url: 'weixin://forged' });
    const stranger = rsaPair();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { headers: wechatHeaders(stranger.privateKey, body) })),
    );

    await expect(
      wechatPay.createNativeOrder({
        amount: 6800,
        description: 'x',
        expiresAt: new Date(),
        notifyUrl: 'https://app.biber.test/n',
        outTradeNo: 'order-1',
      }),
    ).rejects.toThrow('does not match');
  });

  it('reports the error message WeChat Pay returns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'PARAM_ERROR', message: '商户号不存在' }), {
            status: 400,
          }),
      ),
    );

    await expect(wechatPay.queryOrder('order-1')).rejects.toMatchObject({
      message: expect.stringContaining('商户号不存在'),
      status: 400,
    });
  });
});

describe('payment notifications', () => {
  it('returns the payment from a signed, encrypted notification', () => {
    const body = notification(paid);

    expect(wechatPay.readNotification(wechatHeaders(platform.privateKey, body), body)).toEqual(
      paid,
    );
  });

  it('ignores events other than a successful payment', () => {
    const body = notification({ out_refund_no: 'r1' }, 'REFUND.SUCCESS');

    expect(
      wechatPay.readNotification(wechatHeaders(platform.privateKey, body), body),
    ).toBeUndefined();
  });

  it('refuses a forged, replayed, or foreign notification', () => {
    const body = notification(paid);
    const stranger = rsaPair();
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;

    expect(() =>
      wechatPay.readNotification(wechatHeaders(stranger.privateKey, body), body),
    ).toThrow('does not match');
    expect(() =>
      wechatPay.readNotification(
        wechatHeaders(platform.privateKey, body, { timestamp: anHourAgo }),
        body,
      ),
    ).toThrow('expired');
    expect(() =>
      wechatPay.readNotification(
        wechatHeaders(platform.privateKey, body, { serial: 'PUB_KEY_ID_OTHER' }),
        body,
      ),
    ).toThrow('unknown key');
    expect(() => wechatPay.readNotification(new Headers(), body)).toThrow('not signed');

    const otherMerchant = notification({ ...paid, mchid: '1900000999' });
    expect(() =>
      wechatPay.readNotification(wechatHeaders(platform.privateKey, otherMerchant), otherMerchant),
    ).toThrow('another merchant');
  });

  it('refuses a payload that was tampered with after encryption', () => {
    const event = JSON.parse(notification(paid));
    const data = Buffer.from(event.resource.ciphertext, 'base64');
    data[0] ^= 1;
    event.resource.ciphertext = data.toString('base64');
    const body = JSON.stringify(event);

    expect(() =>
      wechatPay.readNotification(wechatHeaders(platform.privateKey, body), body),
    ).toThrow();
  });
});

it('writes times in Beijing time with the offset', () => {
  expect(wechatTime(new Date('2026-12-31T16:05:09Z'))).toBe('2027-01-01T00:05:09+08:00');
});
