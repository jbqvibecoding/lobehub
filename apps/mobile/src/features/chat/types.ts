/** A recent conversation, as `topic.recentTopics` returns it: with one agent, or a group chat. */
export interface RecentConversation {
  agent: { avatar?: string | null; id: string; title?: string | null } | null;
  group?: {
    id: string;
    members: { avatar: string | null; backgroundColor: string | null }[];
    title: string | null;
  } | null;
  id: string;
  title: string | null;
  type: 'agent' | 'group';
  updatedAt: Date;
}

/** One line of a conversation, as `chat.history` returns it. */
export type ChatLine =
  | {
      /** In a group chat: who answered (see `ChatHistory.speakers`). */
      agentId?: string;
      createdAt: Date;
      id: string;
      kind: 'assistant' | 'user';
      text: string;
    }
  | {
      apiName?: string;
      arguments?: string;
      createdAt: Date;
      id: string;
      identifier?: string;
      kind: 'tool';
      /** `waiting`: the call needs the user's answer, given right in the conversation. */
      status: 'done' | 'failed' | 'rejected' | 'waiting';
      title: string;
      type: string;
    };

/** Where the latest run stands: writing, waiting for the user, or done. */
export type ChatRunState = 'idle' | 'running' | 'waiting';

/** Someone who speaks in a conversation: their name and avatar. */
export interface Speaker {
  avatar: string | null;
  backgroundColor: string | null;
  isHost?: boolean;
  title: string;
}

export interface ChatHistory {
  /** In a chat with one agent: who it is with. */
  agentId?: string;
  /** Set for a group chat. */
  groupId?: string;
  lines: ChatLine[];
  run: ChatRunState;
  /** By agent id. */
  speakers?: Record<string, Speaker>;
}

/** Someone in a group chat, as `chat.group` returns them; Biber hosts. */
export interface GroupMember extends Speaker {
  id: string;
  isHost: boolean;
}

export interface GroupChat {
  members: GroupMember[];
  title: string | null;
}
