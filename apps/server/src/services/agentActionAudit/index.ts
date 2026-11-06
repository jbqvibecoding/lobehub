import {
  classifyTool,
  parseToolArguments,
  redactForAudit,
  toolCallDigest,
} from '@lobechat/agent-policy';
import type { ChatToolPayload } from '@lobechat/types';
import debug from 'debug';

import { AgentActionAuditModel } from '@/database/models/agentActionAudit';
import type {
  AgentActionAuditEventType,
  AgentActionAuditPayload,
} from '@/database/schemas/agentActionAudit';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:agent-action-audit');

type AuditedCall = Pick<ChatToolPayload, 'apiName' | 'arguments' | 'id' | 'identifier'>;

interface AgentActionScope {
  agentId?: string;
  operationId?: string;
  topicId?: string;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Runs of read-only tools change nothing, so only their approvals and blocks are recorded; every
 * other run is, whether or not anyone was asked.
 */
export const isAuditedRun = (apiName: string) => classifyTool({ name: apiName }) !== 'read';

/**
 * Appends one event to the user's agent action trail. Never throws: a lost audit row must not stop
 * or fail the action it describes, so a failed write is logged instead.
 */
export const recordAgentAction = async (
  db: LobeChatDatabase,
  eventType: AgentActionAuditEventType,
  call: AuditedCall,
  { agentId, operationId, topicId, userId, workspaceId }: AgentActionScope,
  details: Omit<AgentActionAuditPayload, 'arguments'> = {},
) => {
  try {
    await new AgentActionAuditModel(db, userId).record({
      agentId,
      apiName: call.apiName,
      callDigest: toolCallDigest(call.identifier, call.apiName, call.arguments),
      eventType,
      identifier: call.identifier,
      operationId,
      payload: { arguments: redactForAudit(parseToolArguments(call.arguments)), ...details },
      toolCallId: call.id,
      toolClass: classifyTool({ name: call.apiName }),
      topicId,
      workspaceId: workspaceId ?? undefined,
    });
  } catch (error) {
    log('recording %s for %s/%s failed: %O', eventType, call.identifier, call.apiName, error);
  }
};
