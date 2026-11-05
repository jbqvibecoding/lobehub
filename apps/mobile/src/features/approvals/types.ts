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
  threadId?: string;
  toolCallId?: string;
  topicId?: string;
  type: string;
}

export type ApprovalDecision = 'approved' | 'rejected';
