/** A chat app this service offers (`messenger.availablePlatforms`), with how to reach its bot. */
export interface ChatPlatform {
  botUsername?: string;
  id: string;
  installUrl?: string;
  name: string;
  phoneNumber?: string;
  qrCodeUrl?: string;
}

/** The user's account link on one chat app (`messenger.listMyLinks`). */
export interface ChatLink {
  id: string;
  platform: string;
  platformUsername?: string | null;
  tenantId?: string | null;
}

/** One memory (`memories.list`); dates arrive as `Date` through superjson. */
export interface Memory {
  capturedAt: Date;
  id: string;
  layer: string | null;
  summary: string | null;
  title: string | null;
}

export interface MemoryPage {
  hasMore: boolean;
  items: Memory[];
}

/** One memory extraction the user can undo (`memories.recentExtractions`). */
export interface MemoryExtraction {
  /** Memories it learned that still exist */
  added: number;
  /** Memories it changed or removed that can still be put back */
  changed: number;
  createdAt: Date;
  id: string;
  /** The chat it learned from; null when the chat has no title or was deleted */
  topicTitle: string | null;
}

/** What `memories.undoExtraction` did. */
export type ExtractionUndo =
  { undone: false } | { forgotten: number; notRestored: string[]; restored: number; undone: true };

/** How much Biber speaks up unprompted. */
export type ProactiveLevel = 'off' | 'quiet' | 'standard';

/** The user's proactive settings (`proactive.getSettings`); dates arrive as `Date`. */
export interface ProactiveSettings {
  cooldownUntil: Date | null;
  level: ProactiveLevel;
  quietEnd: number;
  quietStart: number;
  timeZone: string | null;
}

/**
 * Something Biber means to bring up (`proactive.listThoughts`): from memory (`activity`), noted in
 * a chat (`agent`), or a reminder the user asked for (`asked`), sent at `dueAt`.
 */
export interface ProactiveThought {
  dueAt: Date | null;
  expiresAt: Date | null;
  id: string;
  kind: 'follow_up' | 'reminder';
  occursAt: Date | null;
  seed: string;
  source: 'activity' | 'agent' | 'asked';
}

/** One of the experts the user can add to their team (`experts.list`). */
export interface Expert {
  /** The user's agent for this expert, once added */
  agentId: string | null;
  avatar: string;
  backgroundColor: string;
  description: string;
  id: string;
  title: string;
}

/** A mail or calendar app connected through Composio in the global edition. */
export type AccountApp = 'gmail' | 'google-calendar' | 'outlook-mail';

/** A mail provider whose servers the service already knows, in the mainland edition. */
export type MailPreset = '126' | '163' | 'aliyun' | 'exmail' | 'qiye163' | 'qq';

/** Whether a mainland account is connected, and whether it stopped working (`needs_reauth`). */
export interface ConnectedAccount {
  connected: boolean;
  label?: string;
  needsReconnect: boolean;
}

/**
 * What the user can connect under "Email & calendar" (`accounts.list`): Gmail, Google Calendar and
 * Outlook in the global edition, with Composio's connection status (`ACTIVE`, `INITIATED`,
 * `EXPIRED` … or `NONE`); a mailbox and a Feishu calendar in the mainland edition.
 */
export type AccountsOverview =
  | {
      apps: { app: AccountApp; label: string; status: string }[];
      available: boolean;
      edition: 'global';
    }
  | {
      calendar: ConnectedAccount & { available: boolean };
      edition: 'cn';
      mail: ConnectedAccount & { presets: MailPreset[] };
    };
