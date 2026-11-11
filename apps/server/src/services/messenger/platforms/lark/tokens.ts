import debug from 'debug';

import type { MessengerLarkConfig } from '@/config/messenger';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:messenger:lark:tokens');

const AUTH_API: Record<MessengerLarkConfig['platform'], string> = {
  feishu: 'https://open.feishu.cn/open-apis/auth/v3',
  lark: 'https://open.larksuite.com/open-apis/auth/v3',
};

/** Lark and Feishu are separate apps with separate tickets and tokens. */
const keys = (platform: MessengerLarkConfig['platform']) => ({
  appTicket: `messenger:${platform}:app-ticket`,
  appToken: `messenger:${platform}:app-token`,
  tenantToken: (tenantKey: string) => `messenger:${platform}:tenant-token:${tenantKey}`,
});

/** Lark pushes a fresh ticket every hour; a day's margin covers missed deliveries. */
const APP_TICKET_TTL_SECONDS = 24 * 60 * 60;

/** Tokens are used until five minutes before Lark expires them. */
const ttlFor = (expireSeconds?: number) => Math.max(60, (expireSeconds ?? 7200) - 300);

type LarkConfig = Pick<MessengerLarkConfig, 'appId' | 'appSecret' | 'platform'>;

/** The store app has no app ticket yet; Lark has been asked to send one. */
export class LarkAppTicketMissingError extends Error {
  constructor() {
    super('Lark has not delivered an app ticket yet; a resend was requested');
    this.name = 'LarkAppTicketMissingError';
  }
}

// Shared across server instances through Redis; a local process without Redis keeps its own.
const local = new Map<string, { expiresAt: number; value: string }>();

const cache = {
  del: async (key: string) => {
    const redis = getAgentRuntimeRedisClient();
    if (redis) await redis.del(key);
    else local.delete(key);
  },
  get: async (key: string): Promise<string | null> => {
    const redis = getAgentRuntimeRedisClient();
    if (redis) return redis.get(key);
    const entry = local.get(key);
    return entry && entry.expiresAt > Date.now() ? entry.value : null;
  },
  set: async (key: string, value: string, ttlSeconds: number) => {
    const redis = getAgentRuntimeRedisClient();
    if (redis) await redis.set(key, value, 'EX', ttlSeconds);
    else local.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value });
  },
};

const postAuth = async (
  platform: MessengerLarkConfig['platform'],
  path: string,
  payload: Record<string, unknown>,
) => {
  const response = await fetch(`${AUTH_API[platform]}${path}`, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    method: 'POST',
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 0) {
    throw new Error(
      `Lark ${path} failed: ${data.code ?? response.status} ${data.msg ?? ''}`.trim(),
    );
  }
  return data;
};

export const saveLarkAppTicket = (platform: MessengerLarkConfig['platform'], ticket: string) =>
  cache.set(keys(platform).appTicket, ticket, APP_TICKET_TTL_SECONDS);

export const getLarkAppAccessToken = async (config: LarkConfig): Promise<string> => {
  const KEYS = keys(config.platform);
  const cached = await cache.get(KEYS.appToken);
  if (cached) return cached;

  const ticket = await cache.get(KEYS.appTicket);
  if (!ticket) {
    await postAuth(config.platform, '/app_ticket/resend', {
      app_id: config.appId,
      app_secret: config.appSecret,
    }).catch((error) => log('app ticket resend failed: %O', error));
    throw new LarkAppTicketMissingError();
  }

  const data = await postAuth(config.platform, '/app_access_token', {
    app_id: config.appId,
    app_secret: config.appSecret,
    app_ticket: ticket,
  });
  await cache.set(KEYS.appToken, data.app_access_token, ttlFor(data.expire));
  return data.app_access_token;
};

/** The token for one installing tenant, minted from the app token and the tenant's key. */
export const getLarkTenantAccessToken = async (
  config: LarkConfig,
  tenantKey: string,
): Promise<string> => {
  const KEYS = keys(config.platform);
  const cached = await cache.get(KEYS.tenantToken(tenantKey));
  if (cached) return cached;

  const appToken = await getLarkAppAccessToken(config);
  let data: any;
  try {
    data = await postAuth(config.platform, '/tenant_access_token', {
      app_access_token: appToken,
      tenant_key: tenantKey,
    });
  } catch (error) {
    // A rejected app token is dropped so the next call mints a fresh one.
    await cache.del(KEYS.appToken);
    throw error;
  }
  await cache.set(KEYS.tenantToken(tenantKey), data.tenant_access_token, ttlFor(data.expire));
  return data.tenant_access_token;
};
