import {
  createDecipheriv,
  createSign,
  createVerify,
  type KeyObject,
  randomBytes,
} from 'node:crypto';

import { beijingParts, readPrivateKey, readPublicKey } from './keys';

/**
 * WeChat Pay API v3, the calls a Native (QR code) payment needs: place an order, read it back,
 * and verify and decrypt the payment notification. Requests are signed with the merchant's API
 * key; responses and notifications are checked against WeChat Pay's public key.
 */
export interface WechatPayConfig {
  apiV3Key: string;
  appId: string;
  /** Defaults to `https://api.mch.weixin.qq.com` */
  baseUrl?: string;
  merchantId: string;
  merchantSerialNo: string;
  privateKey: KeyObject | string;
  publicKey: KeyObject | string;
  publicKeyId: string;
}

/** A payment as WeChat Pay reports it (the fields this app reads). */
export interface WechatPayTransaction {
  amount?: { currency?: string; payer_total?: number; total?: number };
  appid: string;
  mchid: string;
  out_trade_no: string;
  success_time?: string;
  /** `SUCCESS` once paid; `NOTPAY`, `USERPAYING`, `CLOSED`, `REFUND`, `PAYERROR` otherwise */
  trade_state: string;
  transaction_id?: string;
}

export class WechatPayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'WechatPayError';
  }
}

/** A signature older or newer than this is refused, so a captured message cannot be replayed later. */
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

/** `2026-11-11T10:30:00+08:00`: WeChat Pay reads times in RFC 3339 with an offset. */
export const wechatTime = (date: Date) => {
  const { date: day, time } = beijingParts(date);
  return `${day}T${time}+08:00`;
};

export const createWechatPay = (config: WechatPayConfig) => {
  const baseUrl = config.baseUrl ?? 'https://api.mch.weixin.qq.com';
  const privateKey =
    typeof config.privateKey === 'string' ? readPrivateKey(config.privateKey) : config.privateKey;
  const publicKey =
    typeof config.publicKey === 'string' ? readPublicKey(config.publicKey) : config.publicKey;

  const authorization = (method: string, pathWithQuery: string, body: string, now: Date) => {
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const signature = createSign('RSA-SHA256')
      .update(`${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${body}\n`)
      .sign(privateKey, 'base64');
    return `WECHATPAY2-SHA256-RSA2048 mchid="${config.merchantId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${config.merchantSerialNo}"`;
  };

  /** Checks a response or notification came from WeChat Pay and is recent. */
  const verify = (
    headers: { get: (name: string) => string | null },
    body: string,
    now = new Date(),
  ) => {
    const timestamp = headers.get('wechatpay-timestamp');
    const nonce = headers.get('wechatpay-nonce');
    const signature = headers.get('wechatpay-signature');
    const serial = headers.get('wechatpay-serial');
    if (!timestamp || !nonce || !signature || !serial) {
      throw new WechatPayError('The message is not signed by WeChat Pay');
    }
    if (serial !== config.publicKeyId) {
      throw new WechatPayError(`The message is signed with an unknown key (${serial})`);
    }
    if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
      throw new WechatPayError('The message signature has expired');
    }
    const valid = createVerify('RSA-SHA256')
      .update(`${timestamp}\n${nonce}\n${body}\n`)
      .verify(publicKey, signature, 'base64');
    if (!valid) throw new WechatPayError('The message signature does not match');
  };

  const call = async <T>(method: 'GET' | 'POST', pathWithQuery: string, payload?: object) => {
    const body = payload ? JSON.stringify(payload) : '';
    const now = new Date();
    const response = await fetch(`${baseUrl}${pathWithQuery}`, {
      body: payload ? body : undefined,
      headers: {
        'Accept': 'application/json',
        'Authorization': authorization(method, pathWithQuery, body, now),
        'Content-Type': 'application/json',
        'User-Agent': 'Biber',
      },
      method,
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text;
      try {
        message = JSON.parse(text).message ?? text;
      } catch {
        // Not JSON: report the body as it came
      }
      throw new WechatPayError(`WeChat Pay ${pathWithQuery}: ${message}`, response.status);
    }
    verify(response.headers, text);
    return (text ? JSON.parse(text) : {}) as T;
  };

  /** AES-256-GCM with the APIv3 key: how notifications carry the payment. */
  const decrypt = (resource: {
    associated_data?: string;
    ciphertext: string;
    nonce: string;
  }): string => {
    const data = Buffer.from(resource.ciphertext, 'base64');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(config.apiV3Key, 'utf8'),
      Buffer.from(resource.nonce, 'utf8'),
    );
    decipher.setAuthTag(data.subarray(data.length - 16));
    if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
    return Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString(
      'utf8',
    );
  };

  return {
    /** Places a Native order and returns the `weixin://` link the QR code shows. */
    async createNativeOrder(order: {
      amount: number;
      description: string;
      expiresAt: Date;
      notifyUrl: string;
      outTradeNo: string;
    }) {
      const { code_url } = await call<{ code_url: string }>('POST', '/v3/pay/transactions/native', {
        amount: { currency: 'CNY', total: order.amount },
        appid: config.appId,
        description: order.description,
        mchid: config.merchantId,
        notify_url: order.notifyUrl,
        out_trade_no: order.outTradeNo,
        time_expire: wechatTime(order.expiresAt),
      });
      return code_url;
    },

    /** Reads an order back by our order number. */
    queryOrder(outTradeNo: string) {
      return call<WechatPayTransaction>(
        'GET',
        `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${config.merchantId}`,
      );
    },

    /**
     * Verifies a notification and returns the payment it reports, or nothing for other events.
     * Throws when it is not from WeChat Pay or names another merchant.
     */
    readNotification(
      headers: { get: (name: string) => string | null },
      body: string,
      now = new Date(),
    ): WechatPayTransaction | undefined {
      verify(headers, body, now);
      const event = JSON.parse(body) as {
        event_type: string;
        resource: { associated_data?: string; ciphertext: string; nonce: string };
      };
      if (event.event_type !== 'TRANSACTION.SUCCESS') return undefined;

      const transaction = JSON.parse(decrypt(event.resource)) as WechatPayTransaction;
      if (transaction.mchid !== config.merchantId || transaction.appid !== config.appId) {
        throw new WechatPayError('The payment belongs to another merchant or app');
      }
      return transaction;
    },
  };
};

export type WechatPay = ReturnType<typeof createWechatPay>;
