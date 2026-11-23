/**
 * One tool call waiting for the user, as `approval.listPending` returns it
 * (MessageModel.listPendingInterventions on the server).
 */
export interface PendingApproval {
  agentId?: string;
  apiName?: string;
  /** The tool call's arguments as the model wrote them, a JSON string. */
  arguments?: string;
  createdAt: Date;
  groupId?: string;
  /** The tool message id; `approval.respond` answers by it. */
  id: string;
  /** The tool or connector, e.g. an MCP server. */
  identifier?: string;
  /** What the call would send out that looks like a secret; absent from older servers. */
  secrets?: SecretKind[];
  threadId?: string;
  toolCallId?: string;
  topicId?: string;
  type: string;
}

export type ApprovalDecision = 'approved' | 'rejected';

/**
 * An answer to the coding expert's question: the option(s) picked per question, or
 * `{ __freeform__: text }` for an answer in the user's own words.
 */
export type QuestionAnswer = Record<string, string | string[]>;

/** `findSecrets` on the server. */
export type SecretKind = 'api_key' | 'card_number' | 'id_number' | 'password' | 'private_key';
