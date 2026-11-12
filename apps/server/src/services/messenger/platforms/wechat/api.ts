import debug from 'debug';

import { expiringCache } from '../../expiringCache';

const log = debug('lobe-server:messenger:wechat:api');

/** WeChat's API; a deployment may route it through a fixed-IP proxy, since WeChat allowlists IPs */
export const DEFAULT_WECHAT_API_BASE = 'https://api.weixin.qq.com';

/** Tokens are used until five minutes before WeChat expires them. */
const ttlFor = (expiresIn?: number) => Math.max(60, (expiresIn ?? 7200) - 300);

/** The access token is invalid, expired, or was replaced: fetch a fresh one and try once more. */
const STALE_TOKEN_CODES = new Set([40_001, 40_014, 42_001]);

/** Customer-service text is limited to 2048 bytes; leave room for the multi-byte boundary. */
const TEXT_BYTE_LIMIT = 2000;

export class WechatMpApiError extends Error {
  constructor(
    readonly errcode: number,
    errmsg: string,
  ) {
    super(`WeChat API error ${errcode}: ${errmsg}`);
    this.name = 'WechatMpApiError';
  }
}

/**
 * Splits text into pieces of at most `limit` UTF-8 bytes, at a line break where one is near, and
 * never inside a character.
 */
export const splitWechatText = (text: string, limit = TEXT_BYTE_LIMIT): string[] => {
  const pieces: string[] = [];
  let rest = text.trim();
  while (Buffer.byteLength(rest, 'utf8') > limit) {
    let end = 0;
    let bytes = 0;
    for (const char of rest) {
      const size = Buffer.byteLength(char, 'utf8');
      if (bytes + size > limit) break;
      bytes += size;
      end += char.length;
    }
    const lineBreak = rest.lastIndexOf('\n', end);
    const cut = lineBreak > end / 2 ? lineBreak : end;
    pieces.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
};

export interface WechatMpAppCredentials {
  /** Base URL of WeChat's API (scheme and host); defaults to WeChat's own */
  apiBaseUrl?: string;
  appId: string;
  appSecret: string;
}

/**
 * The calls the shared bot makes on WeChat's API. Replies go out as customer-service messages,
 * which WeChat accepts within 48 hours of the user's last message to the account. The access token
 * is the stable kind, so several server instances can share it without invalidating one another.
 */
export const createWechatMpApi = ({ apiBaseUrl, appId, appSecret }: WechatMpAppCredentials) => {
  const API = `${(apiBaseUrl ?? DEFAULT_WECHAT_API_BASE).replace(/\/+$/, '')}/cgi-bin`;
  const tokenKey = `messenger:wechat:access-token:${appId}`;
  const qrKey = `messenger:wechat:follow-qr:${appId}`;

  const accessToken = async (forceRefresh = false): Promise<string> => {
    if (!forceRefresh) {
      const cached = await expiringCache.get(tokenKey);
      if (cached) return cached;
    }
    const response = await fetch(`${API}/stable_token`, {
      body: JSON.stringify({
        appid: appId,
        force_refresh: forceRefresh,
        grant_type: 'client_credential',
        secret: appSecret,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const data: { access_token?: string; errcode?: number; errmsg?: string; expires_in?: number } =
      await response.json().catch(() => ({}));
    if (!data.access_token) {
      throw new WechatMpApiError(data.errcode ?? response.status, data.errmsg ?? 'no access token');
    }
    await expiringCache.set(tokenKey, data.access_token, ttlFor(data.expires_in));
    return data.access_token;
  };

  /** One authenticated call; a stale token is refreshed and the call repeated once. */
  const call = async <T extends object>(
    path: string,
    body: BodyInit | object,
    retried = false,
  ): Promise<T> => {
    const token = await accessToken(retried);
    const separator = path.includes('?') ? '&' : '?';
    const isJson = !(body instanceof FormData);
    const response = await fetch(`${API}${path}${separator}access_token=${token}`, {
      body: isJson ? JSON.stringify(body) : (body as FormData),
      headers: isJson ? { 'Content-Type': 'application/json' } : undefined,
      method: 'POST',
    });
    const data = (await response.json().catch(() => ({}))) as T & {
      errcode?: number;
      errmsg?: string;
    };
    if (data.errcode && STALE_TOKEN_CODES.has(data.errcode) && !retried) {
      log('access token rejected (%d), refreshing', data.errcode);
      return call(path, body, true);
    }
    if (data.errcode || !response.ok) {
      throw new WechatMpApiError(
        data.errcode ?? response.status,
        data.errmsg ?? response.statusText,
      );
    }
    return data;
  };

  return {
    /** Confirms the AppID and AppSecret by getting an access token; sends nothing. */
    async checkAccess() {
      await accessToken();
    },

    /** Sends text to a follower, split into as many messages as its length needs. */
    async sendText(openId: string, text: string) {
      for (const content of splitWechatText(text)) {
        await call('/message/custom/send', { msgtype: 'text', text: { content }, touser: openId });
      }
    },

    /** Uploads an image as temporary media (kept three days by WeChat) and sends it. */
    async sendImage(openId: string, image: { data: Buffer; filename: string; mimeType: string }) {
      const form = new FormData();
      form.append(
        'media',
        new Blob([new Uint8Array(image.data)], { type: image.mimeType }),
        image.filename,
      );
      const { media_id } = await call<{ media_id: string }>('/media/upload?type=image', form);
      await call('/message/custom/send', { image: { media_id }, msgtype: 'image', touser: openId });
    },

    /** Shows "typing" in the follower's chat for up to 15 seconds. */
    async typing(openId: string) {
      await call('/message/custom/typing', { command: 'Typing', touser: openId });
    },

    /**
     * What the account's follow QR code encodes. Scanning it opens the account in WeChat to follow
     * it, or, for a follower, tells the server they scanned. Permanent codes are limited per
     * account, so one is made and then reused.
     */
    async followQrUrl(): Promise<string> {
      const cached = await expiringCache.get(qrKey);
      if (cached) return cached;
      const { url } = await call<{ url: string }>('/qrcode/create', {
        action_info: { scene: { scene_str: 'biber' } },
        action_name: 'QR_LIMIT_STR_SCENE',
      });
      await expiringCache.set(qrKey, url, 30 * 24 * 60 * 60);
      return url;
    },
  };
};

export type WechatMpApi = ReturnType<typeof createWechatMpApi>;
