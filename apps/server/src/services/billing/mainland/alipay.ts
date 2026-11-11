import { createSign, createVerify, type KeyObject } from 'node:crypto';

import { beijingParts, readPrivateKey, readPublicKey } from './keys';

/**
 * Alipay open platform, the calls a desktop web payment needs: the page-pay link the user is sent
 * to, the trade query, and the asynchronous payment notification. Everything is signed RSA2
 * (SHA256withRSA) with the app's key and checked against Alipay's public key.
 */
export interface AlipayConfig {
  /** Alipay's public key, not the app's own */
  alipayPublicKey: KeyObject | string;
  appId: string;
  /** Defaults to `https://openapi.alipay.com/gateway.do` */
  gateway?: string;
  privateKey: KeyObject | string;
}

/** A trade as Alipay reports it (the fields this app reads). */
export interface AlipayTrade {
  /** When the payment was made, in notifications */
  gmt_payment?: string;
  out_trade_no: string;
  /** When the payment was made, in query results */
  send_pay_date?: string;
  /** In yuan with two decimals, e.g. `68.00` */
  total_amount?: string;
  trade_no?: string;
  /** `TRADE_SUCCESS` or `TRADE_FINISHED` once paid; `WAIT_BUYER_PAY`, `TRADE_CLOSED` otherwise */
  trade_status?: string;
}

export class AlipayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlipayError';
  }
}

/** `2026-11-11 10:30:00` in Beijing time, Alipay's date format. */
export const alipayTime = (date: Date) => {
  const { date: day, time } = beijingParts(date);
  return `${day} ${time}`;
};

/** Fen to Alipay's yuan string: 6800 → `68.00`. */
export const yuan = (fen: number) => (fen / 100).toFixed(2);

/** Yuan string to fen: `68.00` → 6800. */
export const fen = (amount: string | undefined) =>
  amount === undefined ? Number.NaN : Math.round(Number(amount) * 100);

/** What Alipay signs: every non-empty parameter except the signature, sorted, as `k=v&k=v`. */
export const signingContent = (params: Record<string, string | undefined>, exclude: string[]) =>
  Object.keys(params)
    .filter((key) => !exclude.includes(key) && params[key] !== undefined && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

/**
 * The raw JSON of one member of a response object, exactly as sent: Alipay signs those bytes,
 * so they are cut out of the text rather than re-serialized.
 */
export const rawMember = (text: string, member: string): string | undefined => {
  const keyAt = text.indexOf(`"${member}"`);
  if (keyAt < 0) return undefined;
  const start = text.indexOf('{', keyAt + member.length + 2);
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
};

export const createAlipay = (config: AlipayConfig) => {
  const gateway = config.gateway ?? 'https://openapi.alipay.com/gateway.do';
  const privateKey =
    typeof config.privateKey === 'string' ? readPrivateKey(config.privateKey) : config.privateKey;
  const publicKey =
    typeof config.alipayPublicKey === 'string'
      ? readPublicKey(config.alipayPublicKey)
      : config.alipayPublicKey;

  const sign = (content: string) =>
    createSign('RSA-SHA256').update(content, 'utf8').sign(privateKey, 'base64');
  const verifies = (content: string, signature: string) =>
    createVerify('RSA-SHA256').update(content, 'utf8').verify(publicKey, signature, 'base64');

  /** The common request parameters for one API method, signed. */
  const signedRequest = (
    method: string,
    bizContent: object,
    extra: Record<string, string> = {},
    now = new Date(),
  ) => {
    const params: Record<string, string> = {
      app_id: config.appId,
      biz_content: JSON.stringify(bizContent),
      // eslint-disable-next-line unicorn/text-encoding-identifier-case -- Alipay's own spelling
      charset: 'utf-8',
      format: 'JSON',
      method,
      sign_type: 'RSA2',
      timestamp: alipayTime(now),
      version: '1.0',
      ...extra,
    };
    return { ...params, sign: sign(signingContent(params, ['sign'])) };
  };

  return {
    /**
     * The link that opens Alipay's cashier for a desktop payment (`alipay.trade.page.pay`). After
     * paying, the user's browser returns to `returnUrl`; the payment itself arrives at `notifyUrl`.
     */
    pagePayUrl(order: {
      amount: number;
      expiresAt: Date;
      notifyUrl: string;
      outTradeNo: string;
      returnUrl: string;
      subject: string;
    }) {
      const params = signedRequest(
        'alipay.trade.page.pay',
        {
          out_trade_no: order.outTradeNo,
          product_code: 'FAST_INSTANT_TRADE_PAY',
          subject: order.subject,
          time_expire: alipayTime(order.expiresAt),
          total_amount: yuan(order.amount),
        },
        { notify_url: order.notifyUrl, return_url: order.returnUrl },
      );
      return `${gateway}?${new URLSearchParams(params).toString()}`;
    },

    /** Reads a trade by our order number; undefined when Alipay has none (not paid yet). */
    async queryTrade(outTradeNo: string): Promise<AlipayTrade | undefined> {
      const response = await fetch(gateway, {
        body: new URLSearchParams(
          signedRequest('alipay.trade.query', { out_trade_no: outTradeNo }),
        ).toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        method: 'POST',
      });
      const text = await response.text();
      if (!response.ok) throw new AlipayError(`Alipay query failed with HTTP ${response.status}`);

      const raw = rawMember(text, 'alipay_trade_query_response');
      const { sign: signature } = JSON.parse(text) as { sign?: string };
      if (!raw || !signature || !verifies(raw, signature)) {
        throw new AlipayError('The query response is not signed by Alipay');
      }

      const result = JSON.parse(raw) as AlipayTrade & {
        code: string;
        sub_code?: string;
        sub_msg?: string;
      };
      if (result.code === '10000') return result;
      if (result.sub_code === 'ACQ.TRADE_NOT_EXIST') return undefined;
      throw new AlipayError(`Alipay query: ${result.sub_msg ?? result.code}`);
    },

    /**
     * Verifies an asynchronous notification (the posted form fields) and returns the trade.
     * Throws when it is not from Alipay or names another app.
     */
    readNotification(fields: Record<string, string>): AlipayTrade {
      const signature = fields.sign;
      if (!signature || !verifies(signingContent(fields, ['sign', 'sign_type']), signature)) {
        throw new AlipayError('The notification is not signed by Alipay');
      }
      if (fields.app_id !== config.appId) {
        throw new AlipayError('The notification belongs to another app');
      }
      return fields as unknown as AlipayTrade;
    },
  };
};

export type Alipay = ReturnType<typeof createAlipay>;

/** Whether a trade status means the money arrived. */
export const isAlipayPaid = (status: string | undefined) =>
  status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED';
