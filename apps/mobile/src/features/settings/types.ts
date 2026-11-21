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
