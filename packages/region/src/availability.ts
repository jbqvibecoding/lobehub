import { type AppRegion, isMainlandRegion } from './region';

/**
 * Chat platforms an agent bot can connect to in the mainland edition: WeChat, Feishu and QQ.
 * Telegram, iMessage, Discord, Slack, LINE and Lark are unreachable from mainland China or carry
 * user data out of it, so the mainland edition does not offer them. Global offers every platform.
 */
const MAINLAND_BOT_PLATFORMS: readonly string[] = ['feishu', 'qq', 'wechat'];

/**
 * Platforms with one product-owned bot shared by every user (Telegram, Discord) or installed per
 * workspace through OAuth (Slack). None of them is reachable from the mainland edition.
 */
const MAINLAND_MESSENGER_PLATFORMS: readonly string[] = [];

export const isBotPlatformAvailable = (region: AppRegion, platformId: string): boolean =>
  !isMainlandRegion(region) || MAINLAND_BOT_PLATFORMS.includes(platformId);

export const isMessengerPlatformAvailable = (region: AppRegion, platformId: string): boolean =>
  !isMainlandRegion(region) || MAINLAND_MESSENGER_PLATFORMS.includes(platformId);

/**
 * The Cloud Sandbox provider used when none is configured. Global keeps LobeHub's Market sandbox;
 * the mainland edition runs its own agent computers rather than sending code and files abroad.
 */
export const defaultSandboxProviderForRegion = (region: AppRegion): 'market' | 'openbot' =>
  isMainlandRegion(region) ? 'openbot' : 'market';
