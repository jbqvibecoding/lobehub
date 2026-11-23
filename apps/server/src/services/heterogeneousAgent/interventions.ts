/**
 * Claude Code runs in the cloud sandbox ask the user things through `lobe_cc` MCP tools
 * (`ask_user_question`, and later `push_changes`): the call waits in the sandbox until an answer
 * arrives on the run's stream. These helpers make such a call a pending approval like any other —
 * in the phone's list, with a push — and send the user's answer back to the waiting run instead of
 * starting a new one.
 */
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import debug from 'debug';
import { and, eq, sql } from 'drizzle-orm';

import { messagePlugins, messages } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { notifyPendingApprovals } from '@/server/services/approvalNotification';
import { GithubConnectionService, pushSummary } from '@/server/services/githubApp';

const log = debug('lobe-server:hetero-interventions');

/** How Claude Code's tool calls are stored. */
export const HETERO_TOOL_IDENTIFIER = 'claude-code';

/** Claude Code's question to the user (`mcp__lobe_cc__ask_user_question`, as stored). */
export const ASK_USER_API_NAME = 'askUserQuestion';

/** The coding run's request to push to the user's GitHub (`mcp__lobe_cc__push_changes`). */
export const PUSH_CHANGES_API_NAME = 'pushChanges';

/** What the user answered: per question, the option(s) picked; or their own words. */
export type HeteroAnswer = Record<string, string | string[]>;

const pendingCall = (db: LobeChatDatabase, userId: string, toolCallId: string, topicId?: string) =>
  db
    .select({
      agentId: messages.agentId,
      apiName: messagePlugins.apiName,
      id: messagePlugins.id,
      intervention: messagePlugins.intervention,
      topicId: messages.topicId,
    })
    .from(messagePlugins)
    .innerJoin(messages, eq(messages.id, messagePlugins.id))
    .where(
      and(
        eq(messagePlugins.toolCallId, toolCallId),
        eq(messagePlugins.userId, userId),
        eq(messagePlugins.identifier, HETERO_TOOL_IDENTIFIER),
        topicId ? eq(messages.topicId, topicId) : undefined,
      ),
    )
    .limit(1);

/**
 * Follows a batch of a run's events: a call that starts waiting for the user becomes pending
 * (and the phone is told), one the sandbox gave up on (timed out, session ended) stops being.
 */
export const trackHeteroInterventions = async (
  db: LobeChatDatabase,
  {
    events,
    operationId,
    topicId,
    userId,
    workspaceId,
  }: {
    events: Pick<AgentStreamEvent, 'data' | 'type'>[];
    operationId: string;
    topicId: string;
    userId: string;
    workspaceId?: string;
  },
) => {
  for (const event of events) {
    const toolCallId = (event.data as { toolCallId?: unknown } | undefined)?.toolCallId;
    if (typeof toolCallId !== 'string') continue;

    if (event.type === 'agent_intervention_request') {
      const [call] = await pendingCall(db, userId, toolCallId, topicId);
      if (!call) {
        log('op %s: no tool message for intervention %s', operationId, toolCallId);
        continue;
      }
      // A push shows what it would change, as the server holds it, not what the run said it was
      const push =
        call.apiName === PUSH_CHANGES_API_NAME
          ? await new GithubConnectionService(db, userId).pendingPush(toolCallId)
          : undefined;
      await db
        .update(messagePlugins)
        .set({
          ...(push && { arguments: JSON.stringify(pushSummary(push)) }),
          intervention: { operationId, status: 'pending' },
        })
        .where(eq(messagePlugins.id, call.id));
      log('op %s: %s (%s) waits for the user', operationId, toolCallId, call.apiName);
      await notifyPendingApprovals(db, {
        agentId: call.agentId ?? undefined,
        // A question needs an answer, not a yes or no: no Approve / Reject buttons on its push
        actions: call.apiName !== ASK_USER_API_NAME,
        pendingTools: [
          { apiName: call.apiName ?? '', id: toolCallId, identifier: HETERO_TOOL_IDENTIFIER },
        ],
        topicId,
        userId,
        workspaceId,
      }).catch((error) => log('op %s: telling the phone failed: %O', operationId, error));
    }

    if (event.type === 'agent_intervention_response') {
      // Only the sandbox's own give-ups arrive here (timeout, session ended); answers are settled
      // where they are given
      await settleHeteroIntervention(db, userId, toolCallId, 'aborted');
    }
  }
};

/** Marks a pending Claude Code call answered; returns whether this call won the race. */
export const settleHeteroIntervention = async (
  db: LobeChatDatabase,
  userId: string,
  toolCallId: string,
  status: 'aborted' | 'approved' | 'rejected',
) => {
  const rows = await db
    .update(messagePlugins)
    .set({ intervention: { status } })
    .where(
      and(
        eq(messagePlugins.toolCallId, toolCallId),
        eq(messagePlugins.userId, userId),
        eq(messagePlugins.identifier, HETERO_TOOL_IDENTIFIER),
        sql`${messagePlugins.intervention}->>'status' = 'pending'`,
      ),
    )
    .returning({ id: messagePlugins.id });
  return rows.length > 0;
};

/** Gives up every call of a run still waiting for the user, once the run has ended. */
export const abortHeteroInterventions = async (
  db: LobeChatDatabase,
  userId: string,
  operationId: string,
) => {
  await db
    .update(messagePlugins)
    .set({ intervention: { status: 'aborted' } })
    .where(
      and(
        eq(messagePlugins.userId, userId),
        eq(messagePlugins.identifier, HETERO_TOOL_IDENTIFIER),
        sql`${messagePlugins.intervention}->>'status' = 'pending'`,
        sql`${messagePlugins.intervention}->>'operationId' = ${operationId}`,
      ),
    );
};

/**
 * Sends the user's answer to the run that waits for it, on its stream; the sandbox long-polls
 * the stream (`waitInterventionResponse`) and hands the answer to the waiting tool call.
 */
export const sendHeteroAnswer = async ({
  answer,
  decision,
  operationId,
  reason,
  toolCallId,
}: {
  answer?: HeteroAnswer;
  decision: 'approved' | 'rejected';
  operationId: string;
  reason?: string;
  toolCallId: string;
}) => {
  const rejected = decision === 'rejected';
  await createStreamEventManager().publishStreamEvent(operationId, {
    data: {
      cancelReason: rejected ? 'user_cancelled' : undefined,
      cancelled: rejected || undefined,
      // The sandbox hands `result` to the waiting call either way: a refusal carries its reason
      result: rejected ? (reason ? { reason } : undefined) : (answer ?? {}),
      toolCallId,
    },
    stepIndex: 0,
    type: 'agent_intervention_response',
  });
};
