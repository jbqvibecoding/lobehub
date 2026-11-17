/** A recent conversation, as `topic.recentTopics` returns it. */
export interface RecentConversation {
  agent: { avatar?: string | null; id: string; title?: string | null } | null;
  id: string;
  title: string | null;
  type: 'agent' | 'group';
  updatedAt: Date;
}

/** One line of a conversation, as `chat.history` returns it. */
export type ChatLine =
  | { createdAt: Date; id: string; kind: 'assistant' | 'user'; text: string }
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

export interface ChatHistory {
  lines: ChatLine[];
  run: ChatRunState;
}
