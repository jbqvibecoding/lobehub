/** What happened to a tool call at one moment, as the server's agent action trail records it. */
export type ActivityEventType =
  'approval_requested' | 'approved' | 'blocked' | 'failed' | 'rejected' | 'succeeded';

/** One event of `activity.list` (an `agent_action_audits` row on the server). */
export interface ActivityEvent {
  agentId?: string | null;
  apiName: string;
  createdAt: Date;
  eventType: ActivityEventType;
  id: string;
  /** The tool or connector, e.g. `gmail-mcp`. */
  identifier: string;
  payload: {
    /** The call's arguments with credentials and message content replaced by `[REDACTED]`. */
    arguments?: unknown;
    errorCode?: string;
    executionTimeMs?: number;
    rejectionReason?: string;
    /** Where an approval was answered: `mobile`, or the web client's `chat`. */
    via?: string;
  };
  toolCallId?: string | null;
}

export interface ActivityPage {
  items: ActivityEvent[];
  nextCursor?: string;
}
