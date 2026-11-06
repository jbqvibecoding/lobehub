import type { ToolClass } from '@lobechat/agent-policy';
import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers';
import { users } from './user';

/**
 * What happened to one agent tool call at one moment: approval asked, answered, blocked, or the
 * outcome of running it.
 */
export type AgentActionAuditEventType =
  'approval_requested' | 'approved' | 'blocked' | 'failed' | 'rejected' | 'succeeded';

export interface AgentActionAuditPayload {
  /** The call's arguments with credentials and message content replaced by `[REDACTED]` */
  arguments?: unknown;
  /** Why a run failed or was blocked, e.g. `MCP_EXECUTION_ERROR` or `disabled_by_user` */
  errorCode?: string;
  executionTimeMs?: number;
  /** What the user typed when refusing */
  rejectionReason?: string;
  /** Where the user answered an approval, from the resuming request's trigger, e.g. `mobile` */
  via?: string;
}

/**
 * Agent action audits - an append-only trail of what agents did with tools on a user's behalf,
 * allowed or refused. Agent, topic and operation ids carry no foreign key: the trail outlives the
 * conversation it describes, and only goes when the user's account does.
 */
export const agentActionAudits = pgTable(
  'agent_action_audits',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Workspace the run belonged to; null for personal runs */
    workspaceId: text('workspace_id'),

    eventType: text('event_type').$type<AgentActionAuditEventType>().notNull(),

    /** Tool owner, e.g. `gmail-mcp` or `lobe-local-system` */
    identifier: text('identifier').notNull(),
    apiName: text('api_name').notNull(),
    /** `read`, `write` or `sensitive`, as the policy engine classified the call */
    toolClass: text('tool_class').$type<ToolClass>().notNull(),

    /** The model's tool call id; every event of one call shares it */
    toolCallId: text('tool_call_id'),
    operationId: text('operation_id'),
    agentId: text('agent_id'),
    topicId: text('topic_id'),

    /**
     * SHA-256 of the tool, API and canonical arguments: identical for the approval and the run of
     * one call, so a run can be checked against what was approved without storing the arguments
     */
    callDigest: text('call_digest').notNull(),

    payload: jsonb('payload').$type<AgentActionAuditPayload>().default({}).notNull(),

    createdAt: createdAt(),
  },
  (t) => [
    /** Activity feed: a user's newest events first, with cursor pagination */
    index('agent_action_audits_user_id_created_at_idx').on(t.userId, t.createdAt),
    /** Every event of one tool call */
    index('agent_action_audits_tool_call_id_idx').on(t.toolCallId),
  ],
);

export type NewAgentActionAudit = typeof agentActionAudits.$inferInsert;
export type AgentActionAuditItem = typeof agentActionAudits.$inferSelect;
