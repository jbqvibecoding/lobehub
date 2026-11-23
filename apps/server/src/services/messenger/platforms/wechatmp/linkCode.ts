import { randomInt } from 'node:crypto';

import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:messenger:wechatmpmp:link-code');

/**
 * Linking WeChat is confirmed from both ends. WeChat only tells the account a follower's opaque
 * openid, so the web page cannot show whose WeChat it is about to link, and a link someone
 * forwarded could be confirmed by the wrong person. After the confirm on the web, the page shows a
 * six-digit code, and the link takes effect only once that code is sent from the WeChat that
 * asked for the link: the person who confirmed and the person on WeChat are then the same.
 */
export const WECHAT_LINK_CODE_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;

const pendingKey = (openId: string) => `messenger:wechatmp-link-code:${openId}`;

interface PendingWechatLink {
  activeAgentId: string;
  activeAgentName?: string;
  attempts: number;
  code: string;
  userId: string;
  workspaceId: string | null;
}

const redisOrThrow = () => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) throw new Error('Redis is required to confirm a WeChat link');
  return redis;
};

/** Holds the confirmed link until its code arrives from WeChat, and returns the code. */
export const startWechatLinkCode = async (
  openId: string,
  link: Omit<PendingWechatLink, 'attempts' | 'code'>,
): Promise<string> => {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const pending: PendingWechatLink = { ...link, attempts: 0, code };
  await redisOrThrow().set(
    pendingKey(openId),
    JSON.stringify(pending),
    'EX',
    WECHAT_LINK_CODE_TTL_SECONDS,
  );
  log('waiting for the code from %s', openId);
  return code;
};

export type WechatLinkCodeOutcome =
  /** No link waits for this follower. */
  | { status: 'none' }
  /** A link waits, and the message was not a six-digit code. */
  | { status: 'waiting' }
  | { attemptsLeft: number; status: 'wrong' }
  /** Too many wrong codes: the link is dropped, and the follower starts again. */
  | { status: 'tooManyAttempts' }
  | { activeAgentName?: string; status: 'linked' }
  /** The code was right, but the link could not be written (e.g. bound elsewhere meanwhile). */
  | { status: 'failed' };

/** Reads a message from a follower who is not linked yet as the code for their waiting link. */
export const answerWechatLinkCode = async (
  openId: string,
  text: string | undefined,
): Promise<WechatLinkCodeOutcome> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return { status: 'none' };

  const raw = await redis.get(pendingKey(openId));
  if (!raw) return { status: 'none' };
  const pending = JSON.parse(raw) as PendingWechatLink;

  const digits = (text ?? '').normalize('NFKC').replaceAll(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return { status: 'waiting' };

  if (digits !== pending.code) {
    const attempts = pending.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await redis.del(pendingKey(openId));
      log('too many wrong codes from %s; link dropped', openId);
      return { status: 'tooManyAttempts' };
    }
    await redis.set(pendingKey(openId), JSON.stringify({ ...pending, attempts }), 'KEEPTTL');
    return { attemptsLeft: MAX_ATTEMPTS - attempts, status: 'wrong' };
  }

  await redis.del(pendingKey(openId));
  try {
    await new MessengerAccountLinkModel(await getServerDB(), pending.userId).upsertForPlatform({
      activeAgentId: pending.activeAgentId,
      platform: 'wechatmp',
      platformUserId: openId,
      platformUsername: null,
      tenantId: '',
      workspaceId: pending.workspaceId,
    });
  } catch (error) {
    log('linking %s failed after the right code: %O', openId, error);
    return { status: 'failed' };
  }

  log('linked %s', openId);
  return { activeAgentName: pending.activeAgentName, status: 'linked' };
};
