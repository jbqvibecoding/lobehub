import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { getMessengerFeishuConfig } from '@/config/messenger';
import { appEnv } from '@/envs/app';
import { expiringCache } from '@/server/services/messenger/expiringCache';

import { FEISHU_OPEN_API, FeishuApiError } from './feishu';

/**
 * Feishu authorization for the user's calendar, through the Feishu store app Biber's shared bot
 * already uses. The phone opens the authorization page in the system browser, which is not signed
 * in to Biber, so the `state` it carries is what ties the answer back to the user: random, kept
 * for ten minutes, good once.
 */

const AUTHORIZE_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
const TOKEN_URL = `${FEISHU_OPEN_API}/authen/v2/oauth/token`;
const USER_INFO_URL = `${FEISHU_OPEN_API}/authen/v1/user_info`;

/** Read and change the user's calendars and events; offline access for a refresh token. */
export const FEISHU_CALENDAR_SCOPES = [
  'calendar:calendar',
  'calendar:calendar:readonly',
  'offline_access',
];

const STATE_TTL_SECONDS = 10 * 60;
const stateKey = (state: string) => `calendar:feishu:state:${state}`;

export const feishuCalendarRedirectUri = () =>
  new URL('/api/feishu/calendar/callback', appEnv.APP_URL).toString();

/** The Feishu app, when this deployment has one; calendars cannot be connected without it. */
export const feishuApp = async () => {
  const config = await getMessengerFeishuConfig();
  return config ? { appId: config.appId, appSecret: config.appSecret } : undefined;
};

/** The page the user authorizes Biber on, carrying a fresh state for this user. */
export const feishuAuthorizeUrl = async (appId: string, userId: string) => {
  const state = randomBytes(24).toString('hex');
  await expiringCache.set(stateKey(state), userId, STATE_TTL_SECONDS);
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: appId,
    redirect_uri: feishuCalendarRedirectUri(),
    response_type: 'code',
    scope: FEISHU_CALENDAR_SCOPES.join(' '),
    state,
  }).toString();
  return url.toString();
};

/** The user a state was made for, once: a second use, or a late one, gets nothing. */
export const takeFeishuState = async (state: string) => {
  if (!/^[\da-f]{48}$/.test(state)) return undefined;
  const userId = await expiringCache.get(stateKey(state));
  if (userId) await expiringCache.del(stateKey(state));
  return userId ?? undefined;
};

const tokenSchema = z.object({
  access_token: z.string().min(1),
  code: z.number().optional(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  refresh_token_expires_in: z.number().optional(),
});

/** What is kept, encrypted, to act as the user on their calendar. */
export interface FeishuTokens {
  accessToken: string;
  /** Milliseconds since the epoch */
  expiresAt: number;
  refreshToken?: string;
}

const requestToken = async (payload: Record<string, string>): Promise<FeishuTokens> => {
  const response = await fetch(TOKEN_URL, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await response.json().catch(() => ({}));
  const parsed = tokenSchema.safeParse(json);
  if (!response.ok || !parsed.success || (parsed.data.code ?? 0) !== 0) {
    throw new FeishuApiError(
      json?.code ?? response.status,
      json?.error_description ?? json?.msg ?? 'Feishu token request failed',
    );
  }
  return {
    accessToken: parsed.data.access_token,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
    refreshToken: parsed.data.refresh_token,
  };
};

export const exchangeFeishuCode = (app: { appId: string; appSecret: string }, code: string) =>
  requestToken({
    client_id: app.appId,
    client_secret: app.appSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: feishuCalendarRedirectUri(),
  });

export const refreshFeishuToken = (
  app: { appId: string; appSecret: string },
  refreshToken: string,
) =>
  requestToken({
    client_id: app.appId,
    client_secret: app.appSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

/** The user's name on Feishu, to show which account is connected. */
export const feishuUserName = async (accessToken: string) => {
  const response = await fetch(USER_INFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await response.json().catch(() => ({}));
  return typeof json?.data?.name === 'string' && json.data.name ? json.data.name : undefined;
};
