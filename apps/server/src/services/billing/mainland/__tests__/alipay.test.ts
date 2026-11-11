// @vitest-environment node
import { createVerify } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { alipayTime, createAlipay, fen, rawMember, signingContent, yuan } from '../alipay';
import { rsaPair, signWith } from './keys';

const app = rsaPair();
const alipayKeys = rsaPair();

/** The keys as Alipay's console hands them out: bare base64, no PEM armor. */
const bare = (pem: string) => pem.replaceAll(/-----[^-]+-----|\s/g, '');

const alipay = createAlipay({
  alipayPublicKey: bare(alipayKeys.publicKey),
  appId: '2021000000000001',
  privateKey: bare(app.privateKey),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('page pay', () => {
  it('builds a cashier link signed with the app key', () => {
    const link = new URL(
      alipay.pagePayUrl({
        amount: 19_800,
        expiresAt: new Date('2026-11-11T02:30:00Z'),
        notifyUrl: 'https://app.biber.test/api/webhooks/alipay',
        outTradeNo: 'order-2',
        returnUrl: 'https://app.biber.test/settings/plans?order=o2',
        subject: 'Biber 进阶版（月付）',
      }),
    );
    const params = Object.fromEntries(link.searchParams);

    expect(link.origin + link.pathname).toBe('https://openapi.alipay.com/gateway.do');
    expect(params).toMatchObject({
      app_id: '2021000000000001',
      // eslint-disable-next-line unicorn/text-encoding-identifier-case -- Alipay's own spelling
      charset: 'utf-8',
      method: 'alipay.trade.page.pay',
      notify_url: 'https://app.biber.test/api/webhooks/alipay',
      return_url: 'https://app.biber.test/settings/plans?order=o2',
      sign_type: 'RSA2',
      version: '1.0',
    });
    expect(JSON.parse(params.biz_content)).toEqual({
      out_trade_no: 'order-2',
      product_code: 'FAST_INSTANT_TRADE_PAY',
      subject: 'Biber 进阶版（月付）',
      time_expire: '2026-11-11 10:30:00',
      total_amount: '198.00',
    });
    expect(
      createVerify('RSA-SHA256')
        .update(signingContent(params, ['sign']))
        .verify(app.publicKey, params.sign, 'base64'),
    ).toBe(true);
  });
});

describe('notifications', () => {
  const fields = () => {
    const unsigned: Record<string, string> = {
      app_id: '2021000000000001',
      gmt_payment: '2026-11-11 10:31:02',
      notify_type: 'trade_status_sync',
      out_trade_no: 'order-2',
      total_amount: '198.00',
      trade_no: '2026111122001',
      trade_status: 'TRADE_SUCCESS',
    };
    return {
      ...unsigned,
      sign: signWith(alipayKeys.privateKey, signingContent(unsigned, [])),
      sign_type: 'RSA2',
    };
  };

  it('returns the trade from a notification Alipay signed', () => {
    expect(alipay.readNotification(fields())).toMatchObject({
      out_trade_no: 'order-2',
      total_amount: '198.00',
      trade_status: 'TRADE_SUCCESS',
    });
  });

  it('refuses a notification that was changed, forged, or for another app', () => {
    expect(() => alipay.readNotification({ ...fields(), total_amount: '0.01' })).toThrow(
      'not signed',
    );
    expect(() => alipay.readNotification({ ...fields(), sign: '' })).toThrow('not signed');

    const foreign: Record<string, string> = { app_id: '2021999', out_trade_no: 'order-2' };
    expect(() =>
      alipay.readNotification({
        ...foreign,
        sign: signWith(alipayKeys.privateKey, signingContent(foreign, [])),
      }),
    ).toThrow('another app');
  });
});

describe('trade query', () => {
  const respond = (member: string, signer = alipayKeys.privateKey) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            `{"alipay_trade_query_response":${member},"sign":"${signWith(signer, member)}"}`,
          ),
      ),
    );

  it('reads a paid trade from a signed response, byte for byte as sent', async () => {
    respond(
      '{"code":"10000","msg":"Success","out_trade_no":"order-2","trade_no":"2026111122001","trade_status":"TRADE_SUCCESS","total_amount":"198.00","buyer_logon_id":"a\\"b}c"}',
    );

    await expect(alipay.queryTrade('order-2')).resolves.toMatchObject({
      total_amount: '198.00',
      trade_status: 'TRADE_SUCCESS',
    });
  });

  it('treats a trade Alipay does not have yet as unpaid', async () => {
    respond('{"code":"40004","msg":"Business Failed","sub_code":"ACQ.TRADE_NOT_EXIST"}');

    await expect(alipay.queryTrade('order-2')).resolves.toBeUndefined();
  });

  it('refuses a response Alipay did not sign', async () => {
    respond('{"code":"10000","trade_status":"TRADE_SUCCESS"}', rsaPair().privateKey);

    await expect(alipay.queryTrade('order-2')).rejects.toThrow('not signed');
  });
});

describe('formats', () => {
  it('signs the sorted non-empty parameters', () => {
    expect(signingContent({ b: '2', a: '1', c: '', sign: 'x', d: undefined }, ['sign'])).toBe(
      'a=1&b=2',
    );
  });

  it('cuts a member out of a response as sent, braces inside strings included', () => {
    expect(rawMember('{"r":{"a":"}{","b":{"c":1}},"sign":"s"}', 'r')).toBe(
      '{"a":"}{","b":{"c":1}}',
    );
    expect(rawMember('{"other":{}}', 'r')).toBeUndefined();
  });

  it('converts between fen and yuan and writes Beijing time', () => {
    expect(yuan(6800)).toBe('68.00');
    expect(fen('468.00')).toBe(46_800);
    expect(fen('0.29')).toBe(29);
    expect(alipayTime(new Date('2026-12-31T16:05:09Z'))).toBe('2027-01-01 00:05:09');
  });
});
