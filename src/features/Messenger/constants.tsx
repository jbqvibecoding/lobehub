import { Discord, IMessage, Slack, Telegram } from '@lobehub/ui/icons';
import type { ReactNode } from 'react';

export type MessengerPlatform = 'telegram' | 'slack' | 'discord' | 'imessage';

export const SUPPORTED_MESSENGER_PLATFORMS = [
  { id: 'telegram', name: 'Telegram' },
  { id: 'slack', name: 'Slack' },
  { id: 'discord', name: 'Discord' },
  { id: 'imessage', name: 'iMessage' },
] as const satisfies readonly { id: MessengerPlatform; name: string }[];

export const isMessengerPlatform = (value: string | null | undefined): value is MessengerPlatform =>
  SUPPORTED_MESSENGER_PLATFORMS.some((platform) => platform.id === value);

/** Platforms served by one shared bot that every user links to (no per-workspace install). */
export type SharedBotPlatform = Extract<MessengerPlatform, 'imessage' | 'telegram'>;

export const PLATFORM_TAB_ICONS: Record<MessengerPlatform, ReactNode> = {
  discord: <Discord.Color size={16} />,
  imessage: <IMessage.Color size={16} />,
  slack: <Slack.Color size={16} />,
  telegram: <Telegram.Color size={16} />,
};

export const PlatformAvatar = ({
  platform,
  size,
}: {
  platform: MessengerPlatform;
  size: number;
}) => {
  if (platform === 'telegram') return <Telegram.Avatar size={size} />;
  if (platform === 'discord') return <Discord.Avatar size={size} />;
  if (platform === 'imessage') return <IMessage.Avatar size={size} />;
  return <Slack.Avatar size={size} />;
};

export const PlatformBrandIcon = ({
  platform,
  size,
}: {
  platform: MessengerPlatform;
  size: number;
}) => {
  if (platform === 'telegram') return <Telegram.Color size={size} />;
  if (platform === 'discord') return <Discord.Color size={size} />;
  if (platform === 'imessage') return <IMessage.Color size={size} />;
  return <Slack.Color size={size} />;
};

/**
 * Plain Telegram bot URL — no `?start=messenger` suffix. Used by the verify
 * success state where re-triggering the bot's `/start` flow right after
 * binding would be redundant.
 */
export const buildTelegramBotUrl = (botUsername: string): string =>
  `https://t.me/${botUsername.replace(/^@/, '')}`;

export const buildTelegramDeepLink = (botUsername: string): string =>
  `${buildTelegramBotUrl(botUsername)}?start=messenger`;

/**
 * Slack bot deep link. Prefer the `app_redirect` form when both `appId` and
 * `tenantId` are known — Slack handles desktop hand-off and lands the user in
 * the bot DM. Falls back to the workspace URL when only the team id is known.
 */
export const buildSlackOpenBotUrl = (tenantId: string, appId?: string): string =>
  appId
    ? `https://slack.com/app_redirect?app=${appId}&team=${tenantId}`
    : `https://app.slack.com/client/${tenantId}`;

/**
 * Direct link to the bot's user profile in Discord. App IDs double as the
 * bot user id for bot accounts, so this URL opens the bot's profile page;
 * the user clicks "Send Message" to start a DM.
 *
 * Note: the "Add to Discord server" install flow goes through
 * `/api/agent/messenger/discord/install` (OAuth code-grant) rather than a
 * hardcoded `discord.com/oauth2/authorize` URL, so the callback can persist
 * the guild as an audit row. Bot scopes / permissions live in
 * `src/server/services/messenger/platforms/discord/oauth.ts`.
 */
export const buildDiscordOpenBotUrl = (applicationId: string): string =>
  `https://discord.com/users/${applicationId}`;

/**
 * Starts a message to the shared iMessage line. `sms:` opens Messages on iPhone, iPad and Mac,
 * which sends it as an iMessage, and the SMS app elsewhere.
 */
export const buildImessageUrl = (phoneNumber: string): string =>
  `sms:${phoneNumber.replaceAll(/[^\d+]/g, '')}`;

/** Where to message the shared bot, or null when the deployment has not configured it. */
export const sharedBotUrl = (
  platform: SharedBotPlatform,
  meta: { botUsername?: string; phoneNumber?: string },
): string | null => {
  if (platform === 'imessage') return meta.phoneNumber ? buildImessageUrl(meta.phoneNumber) : null;
  return meta.botUsername ? buildTelegramBotUrl(meta.botUsername) : null;
};
