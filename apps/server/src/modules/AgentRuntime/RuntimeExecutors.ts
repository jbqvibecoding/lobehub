import type { AgentInstruction, AgentState, InstructionExecutor } from '@lobechat/agent-runtime';
import {
  callLlm as createCallLlmExecutor,
  callTool as createCallToolExecutor,
  callToolsBatch as createCallToolsBatchExecutor,
  compressContext as createCompressContextExecutor,
  execSubAgent as createExecSubAgentExecutor,
  execSubAgents as createExecSubAgentsExecutor,
  finish as createFinishExecutor,
  requestHumanApprove as createRequestHumanApproveExecutor,
  resolveAbortedTools as createResolveAbortedToolsExecutor,
  resolveBlockedTools as createResolveBlockedToolsExecutor,
} from '@lobechat/agent-runtime';
import debug from 'debug';

import { notifyPendingApprovals } from '@/server/services/approvalNotification';

import { buildHost } from './buildHost';
import type { RuntimeExecutorContext } from './context';

export { type RuntimeExecutorContext } from './context';

const log = debug('lobe-server:agent-runtime:executors');

export const createRuntimeExecutors = (
  ctx: RuntimeExecutorContext,
): Partial<Record<AgentInstruction['type'], InstructionExecutor>> => {
  // Package-hosted executors take an AgentRuntimeHost (transport adapters +
  // operation context) instead of the raw server ctx. Built once per operation.
  const host = buildHost(ctx);
  const requestHumanApprove = createRequestHumanApproveExecutor(host);

  return {
    call_llm: createCallLlmExecutor(host),
    call_tool: createCallToolExecutor(host),
    call_tools_batch: createCallToolsBatchExecutor(host),
    compress_context: createCompressContextExecutor(host),
    exec_sub_agent: createExecSubAgentExecutor(host),
    exec_sub_agents: createExecSubAgentsExecutor(host),
    // Migrated into @lobechat/agent-runtime as part of the IO transport port
    // abstraction — the server now only registers adapters via buildHost.
    finish: createFinishExecutor(host),
    request_human_approve: async (instruction, state) => {
      const result = await requestHumanApprove(instruction, state);
      await tellUserTheRunWaits(ctx, instruction, state);
      return result;
    },
    resolve_aborted_tools: createResolveAbortedToolsExecutor(host),
    resolve_blocked_tools: createResolveBlockedToolsExecutor(host),
  };
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
      agentId: state.metadata?.agentId,
      pendingTools: instruction.pendingToolsCalling,
      topicId: ctx.topicId ?? state.metadata?.topicId,
      userId: ctx.userId,
    });
  } catch (error) {
    log('notifying op=%s of a pending approval failed: %O', ctx.operationId, error);
  }
};
