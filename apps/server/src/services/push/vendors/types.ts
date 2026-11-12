import type { PushTokenProvider } from '@/database/schemas';

/** A phone maker's push service. */
export type VendorPushProvider = Exclude<PushTokenProvider, 'expo'>;

export const VENDOR_PUSH_PROVIDERS = [
  'honor',
  'huawei',
  'oppo',
  'vivo',
  'xiaomi',
] as const satisfies readonly VendorPushProvider[];

export const isVendorPushProvider = (provider: string): provider is VendorPushProvider =>
  (VENDOR_PUSH_PROVIDERS as readonly string[]).includes(provider);

/** What every vendor notification carries. Tapping it opens the app. */
export interface VendorNotification {
  body: string;
  title: string;
}

export interface VendorSendResult {
  /** Tokens the vendor no longer knows (app uninstalled, data cleared); they should be forgotten */
  invalidTokens: string[];
}

export interface VendorPushSender {
  send: (tokens: string[], notification: VendorNotification) => Promise<VendorSendResult>;
}

export class VendorPushError extends Error {
  constructor(
    readonly provider: VendorPushProvider,
    message: string,
  ) {
    super(`${provider} push: ${message}`);
    this.name = 'VendorPushError';
  }
}

/** Splits a list into pieces of at most `size`, for vendors that cap tokens per request. */
export const inBatches = <T>(items: T[], size: number): T[][] => {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
};

/**
 * An access token kept in this process until shortly before it expires. Tokens from every vendor
 * here can be held by several servers at once, so each server keeps its own.
 */
export const tokenHolder = (
  fetchToken: () => Promise<{ expiresInSeconds: number; token: string }>,
) => {
  let held: { expiresAt: number; token: string } | undefined;
  return {
    clear: () => {
      held = undefined;
    },
    get: async (): Promise<string> => {
      if (held && held.expiresAt > Date.now()) return held.token;
      const { expiresInSeconds, token } = await fetchToken();
      held = { expiresAt: Date.now() + Math.max(60, expiresInSeconds - 300) * 1000, token };
      return token;
    },
  };
};
