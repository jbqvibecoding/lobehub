import type { AgentInstruction, AgentState, InstructionExecutor } from '@lobechat/agent-runtime';
import { createAgentRuntimeExecutors } from '@lobechat/agent-runtime';
import debug from 'debug';

import { recordAgentAction } from '@/server/services/agentActionAudit';
import { notifyPendingApprovals } from '@/server/services/approvalNotification';

import { buildHost } from './buildHost';
import type { RuntimeExecutorContext } from './context';

export { type RuntimeExecutorContext } from './context';

const log = debug('lobe-server:agent-runtime:executors');

export const createRuntimeExecutors = (
  ctx: RuntimeExecutorContext,
): Partial<Record<AgentInstruction['type'], InstructionExecutor>> => {
  // Package-hosted executors take an AgentRuntimeHost (transport adapters + operation context)
  // instead of the raw server ctx. Built once per operation. Biber records approval requests and
  // blocked calls in the activity trail and tells the user a run waits for them.
  const executors = createAgentRuntimeExecutors(buildHost(ctx));
  const requestHumanApprove = executors.request_human_approve!;
  const resolveBlockedTools = executors.resolve_blocked_tools!;

  return {
    ...executors,
    request_human_approve: async (instruction, state, runtimeContext) => {
      const result = await requestHumanApprove(instruction, state, runtimeContext);
      await recordApprovalRequests(ctx, instruction, state);
      await tellUserTheRunWaits(ctx, instruction, state);
      return result;
    },
    resolve_blocked_tools: async (instruction, state, runtimeContext) => {
      const result = await resolveBlockedTools(instruction, state, runtimeContext);
      await recordBlockedCalls(ctx, instruction, state);
      return result;
    },
  };
};

const auditScope = (ctx: RuntimeExecutorContext, state: AgentState, userId: string) => ({
  agentId: state.origin?.agentId,
  operationId: ctx.operationId,
  topicId: ctx.topicId ?? state.origin?.topicId,
  userId,
  workspaceId: ctx.workspaceId,
});

/** A resumed pause re-asks only calls that were already recorded when it first paused. */
const recordApprovalRequests = async (
  ctx: RuntimeExecutorContext,
  instruction: AgentInstruction,
  state: AgentState,
) => {
  if (!ctx.userId || instruction.type !== 'request_human_approve') return;
  if (instruction.skipCreateToolMessage) return;

  for (const call of instruction.pendingToolsCalling) {
    await recordAgentAction(
      ctx.serverDB,
      'approval_requested',
      call,
      auditScope(ctx, state, ctx.userId),
    );
  }
};

/** Calls the policy refused outright, typically ones needing approval in a run nobody watches. */
const recordBlockedCalls = async (
  ctx: RuntimeExecutorContext,
  instruction: AgentInstruction,
  state: AgentState,
) => {
  if (!ctx.userId || instruction.type !== 'resolve_blocked_tools') return;

  const { blockedReason, toolsCalling } = instruction.payload;
  for (const call of toolsCalling) {
    await recordAgentAction(ctx.serverDB, 'blocked', call, auditScope(ctx, state, ctx.userId), {
      errorCode: blockedReason ?? 'blocked_by_security_privacy',
    });
  }
};

/**
 * The run is paused until the user answers, wherever they are: reach their phones. A failed push
 * must not fail the step; the pause is already saved and visible in the app.
 */
const tellUserTheRunWaits = async (
  ctx: RuntimeExecutorContext,
  instruction: AgentInstruction,
  state: AgentState,
) => {
  if (!ctx.userId || instruction.type !== 'request_human_approve') return;

  try {
    await notifyPendingApprovals(ctx.serverDB, {
      agentId: state.origin?.agentId,
      pendingTools: instruction.pendingToolsCalling,
      topicId: ctx.topicId ?? state.origin?.topicId,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
  } catch (error) {
    log('notifying op=%s of a pending approval failed: %O', ctx.operationId, error);
  }
};
