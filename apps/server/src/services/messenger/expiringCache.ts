import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

/**
 * Short-lived values the shared bots keep between requests: platform access tokens, and markers
 * that a delivery was already handled. Shared across server instances through Redis; a local
 * process without Redis keeps its own.
 */
const local = new Map<string, { expiresAt: number; value: string }>();

const liveLocal = (key: string) => {
  const entry = local.get(key);
  return entry && entry.expiresAt > Date.now() ? entry : undefined;
};

export const expiringCache = {
  del: async (key: string) => {
    const redis = getAgentRuntimeRedisClient();
    if (redis) await redis.del(key);
    else local.delete(key);
  },

  get: async (key: string): Promise<string | null> => {
    const redis = getAgentRuntimeRedisClient();
    if (redis) return redis.get(key);
    return liveLocal(key)?.value ?? null;
  },

  set: async (key: string, value: string, ttlSeconds: number) => {
    const redis = getAgentRuntimeRedisClient();
    if (redis) await redis.set(key, value, 'EX', ttlSeconds);
    else local.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value });
  },

  /** Stores the key only if it is absent; true for the one caller that stored it. */
  claim: async (key: string, ttlSeconds: number): Promise<boolean> => {
    const redis = getAgentRuntimeRedisClient();
    if (redis) return (await redis.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
    if (liveLocal(key)) return false;
    local.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value: '1' });
    return true;
  },
};
