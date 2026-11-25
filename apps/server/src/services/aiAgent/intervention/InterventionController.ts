import type { AgentState } from '@lobechat/agent-runtime';
import { parseOperationId } from '@lobechat/agent-tracing';
import type { LobeChatDatabase } from '@lobechat/database';
import {
  isLocalHeterogeneousType,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import { ThreadStatus } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';

import {
  deriveAgentInterventionQueueDeduplicationId,
  matchesAgentInterventionContinuationProvenance,
} from '@/business/server/agent-run/agentInterventionIdentity';
import type { AgentOperationModel } from '@/database/models/agentOperation';
import type { MessageModel } from '@/database/models/message';
import { HumanApprovalAlreadyResolvedError } from '@/database/models/message';
import type { ThreadModel } from '@/database/models/thread';
import type { TopicModel } from '@/database/models/topic';
import type { AgentRuntimeService } from '@/server/services/agentRuntime';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';
import type { SerializedHook } from '@/server/services/agentRuntime/hooks/types';
import { deviceGateway } from '@/server/services/deviceGateway';
import { HeterogeneousAgentService } from '@/server/services/heterogeneousAgent';
import { abortHeteroInterventions } from '@/server/services/heterogeneousAgent/interventions';
import type { MarketService } from '@/server/services/market';

import { STOPPED_TOOL_CONTENT } from '../helpers/agentFactory';

const log = debug('lobe-server:ai-agent-service');

interface InterventionControllerDeps {
  agentOperationModel: AgentOperationModel;
  agentRuntimeService: AgentRuntimeService;
  db: LobeChatDatabase;
  /** For killing a Claude Code / Codex run in the cloud sandbox (Biber) */
  getMarketService: () => Promise<MarketService>;
  messageModel: MessageModel;
  resolveDeviceWorkspaceId: (deviceId: string | undefined) => Promise<string | undefined>;
  threadModel: ThreadModel;
  topicModel: TopicModel;
  userId: string;
  workspaceId?: string;
}

/**
 * Owner-scoped collaborator for run interruption and human-approval lifecycle:
 * interrupt a live run (coordinating device-hosted process shutdown), settle
 * parked approval batches, retire superseded operations, and repair
 * intervention continuation anchors.
 */
export class InterventionController {
  private readonly deps: InterventionControllerDeps;

  constructor(deps: InterventionControllerDeps) {
    this.deps = deps;
  }

  /**
   * Mirrors whether the composer still holds user messages queued behind a
   * run, so the run hands its turn back at the next step boundary.
   *
   * Returns:
   * - `success: false` when the operation is unknown or not owned by this user.
   */
  async setQueuedMessages(params: {
    operationId: string;
    pending: boolean;
  }): Promise<{ success: boolean }> {
    const { operationId, pending } = params;
    const success = await this.deps.agentRuntimeService.setQueuedMessages(operationId, pending);
    log('setQueuedMessages: operationId=%s, pending=%s, success=%s', operationId, pending, success);

    return { success };
  }

  /**
   * Interrupts a running task and coordinates any device-hosted process shutdown.
   *
   * Call stack:
   *
   * execAgent (replacement path)
   *   -> {@link AiAgentService.interruptTask}
   *     -> deviceGateway.executeToolCall(cancelHeteroTask)
   *       -> HeterogeneousAgentCtr.cancelLhHeteroExec
   *
   * Use when:
   * - A user stops an agent runtime by thread or operation id.
   * - A replacement run must wait for a device-hosted native writer to exit.
   *
   * Expects:
   * - At least one of `threadId` or `operationId` resolves to an owned operation.
   *
   * Returns:
   * - Runtime cancellation status and, for local device agents, whether process exit was confirmed.
   */
  async interruptTask(params: {
    operationId?: string;
    threadId?: string;
    topicId?: string;
  }): Promise<{
    deviceCancellationConfirmed?: boolean;
    operationId?: string;
    success: boolean;
    threadId?: string;
  }> {
    const { threadId, operationId, topicId } = params;

    log('interruptTask: threadId=%s, operationId=%s', threadId, operationId);

    // 1. Get operationId and thread
    let resolvedOperationId = operationId;
    let thread;
    let deviceCancellationConfirmed: boolean | undefined;

    if (threadId) {
      thread = await this.deps.threadModel.findById(threadId);
      if (!thread) {
        throw new Error('Thread not found');
      }
      resolvedOperationId = resolvedOperationId || thread.metadata?.operationId;
    }

    if (!resolvedOperationId) {
      throw new Error('Operation ID not found');
    }

    // Not every cancellation entry point knows the topic (reconnect, task,
    // bot/messenger stop). Recover it from the owner-scoped operation row so
    // device cancellation is symmetric across every caller.
    let resolvedTopicId = topicId;
    if (!resolvedTopicId) {
      const operation = await this.deps.agentOperationModel.findById(resolvedOperationId);
      resolvedTopicId = operation?.topicId ?? undefined;
    }

    // 2. Cancel a device-hosted hetero process if applicable.
    // Check topic.metadata.runningOperation for device + heteroType info seeded by execAgent.
    // This runs regardless of whether interruptOperation succeeds — the remote process
    // is independent of the local operation registry.
    if (resolvedTopicId) {
      const topic = await this.deps.topicModel.findById(resolvedTopicId);
      const runningOp = (topic?.metadata as any)?.runningOperation as
        | {
            deviceId?: string;
            deviceUserId?: string;
            deviceWorkspaceId?: string;
            heteroType?: string;
            operationId?: string;
            childOperations?: Array<{
              deviceId?: string;
              deviceUserId?: string;
              deviceWorkspaceId?: string;
              heteroType?: string;
              operationId?: string;
            }>;
          }
        | undefined;
      const targetOperation =
        runningOp?.operationId === resolvedOperationId
          ? runningOp
          : runningOp?.childOperations?.find((child) => child.operationId === resolvedOperationId);

      if (
        targetOperation?.deviceId &&
        targetOperation.heteroType &&
        (isRemoteHeterogeneousType(targetOperation.heteroType) ||
          isLocalHeterogeneousType(targetOperation.heteroType))
      ) {
        const taskId = targetOperation.operationId ?? resolvedOperationId;
        log(
          'interruptTask: cancelling device hetero process heteroType=%s deviceId=%s taskId=%s',
          targetOperation.heteroType,
          targetOperation.deviceId,
          taskId,
        );
        const cancelWorkspaceId =
          targetOperation.deviceWorkspaceId ??
          (await this.deps.resolveDeviceWorkspaceId(targetOperation.deviceId));
        const cancelResult = await deviceGateway.executeToolCall(
          {
            deviceId: targetOperation.deviceId,
            userId: targetOperation.deviceUserId ?? this.deps.userId,
            workspaceId: cancelWorkspaceId,
          },
          {
            apiName: 'cancelHeteroTask',
            arguments: JSON.stringify({ signal: 'SIGINT', taskId }),
            identifier: 'cancelHeteroTask',
          },
          // The device first gives the wrapper/native CLI 2s to stop
          // cooperatively, then escalates and drains its terminal callback.
          10_000,
        );

        if (isLocalHeterogeneousType(targetOperation.heteroType)) {
          deviceCancellationConfirmed =
            cancelResult.success &&
            isRecord(cancelResult.state) &&
            cancelResult.state.exited === true;
        }

        if (!cancelResult.success || deviceCancellationConfirmed === false) {
          log(
            'interruptTask: device cancellation unconfirmed taskId=%s success=%s state=%O error=%s',
            taskId,
            cancelResult.success,
            cancelResult.state,
            cancelResult.error,
          );
          // Preserve the runtime and topic's device identity until the writer
          // actually exits, so a retry can still address the same process.
          return {
            deviceCancellationConfirmed,
            operationId: resolvedOperationId,
            success: false,
            threadId: thread?.id,
          };
        }
      }
    }

    // 2b. A Claude Code / Codex run in the cloud sandbox is not in the runtime registry: kill its
    // command and close the run here (Biber).
    if (
      resolvedTopicId &&
      (await this.stopSandboxHeteroRun(resolvedTopicId, resolvedOperationId))
    ) {
      return { operationId: resolvedOperationId, success: true, threadId: thread?.id };
    }
    // A group member's CLI run stops on its own; stopping the host stops its members as well
    if (
      resolvedTopicId &&
      (await this.stopSandboxMemberRuns(resolvedTopicId, resolvedOperationId))
    ) {
      return { operationId: resolvedOperationId, success: true, threadId: thread?.id };
    }

    // 3. Interrupt the runtime operation first. Only mark the thread cancelled
    // after the runtime acknowledges the interrupt to avoid unlocking a live task.
    const interrupted = await this.deps.agentRuntimeService.interruptOperation(resolvedOperationId);
    log(
      'interruptTask: interruptOperation=%s for operationId=%s',
      interrupted,
      resolvedOperationId,
    );

    // Device CLI runs have no native AgentRuntime state to interrupt. Their
    // acknowledged process exit is authoritative; settle only the owned old
    // operation and its matching marker, preserving any newer run/outcome.
    if (deviceCancellationConfirmed === true) {
      await this.deps.agentOperationModel.settleRunning(resolvedOperationId, 'interrupted');
      if (resolvedTopicId) {
        await this.deps.topicModel.settleRunningOperation(
          resolvedTopicId,
          resolvedOperationId,
          'active',
        );
      }
    }

    if (!interrupted && deviceCancellationConfirmed !== true) {
      const alreadyCancelled = thread?.status === ThreadStatus.Cancel;

      return {
        deviceCancellationConfirmed,
        operationId: resolvedOperationId,
        success: alreadyCancelled,
        threadId: thread?.id,
      };
    }

    // 4. Update Thread status to cancel
    if (thread) {
      await this.deps.threadModel.update(thread.id, {
        metadata: {
          ...thread.metadata,
          completedAt: new Date().toISOString(),
        },
        status: ThreadStatus.Cancel,
      });
    }

    return {
      deviceCancellationConfirmed,
      operationId: resolvedOperationId,
      success: true,
      threadId: thread?.id,
    };
  }

  /**


   * tool rows and terminate the operation, WITHOUT executing anything and
   * without continuing the model.
   *
   * This is the "from this step on, don't go any further" action. It is not the
   * same as rejecting a tool — a rejection resumes the model so it can respond
   * to the refusal, whereas stopping ends the turn outright.
   *
   * Why it can't reuse the ordinary cancel path: when the runtime parks it
   * emits a stream-terminal `waiting_for_human`, so the client marks its own
   * operation `completed` and prunes it ~30s later. The pending tool rows retain
   * the authoritative operation and sealed-batch identity; callers must send
   * that exact correlation and this service verifies it against both the
   * operation record and every batch member before claiming anything.
   *
   * The tool rows are settled IN PLACE (the approval pause already created one
   * row per pending call). Inserting fresh aborted rows would duplicate every
   * tool in the turn and leave the originals `pending`, which is exactly what
   * keeps the approval cards on screen after a stop.
   */
  async stopPendingApproval(params: {
    approvalResolutionRequestId?: string;
    batchId: string;
    operationId: string;
    toolMessageIds: string[];
    topicId: string;
  }): Promise<{
    operationId: string;
    settledToolMessageIds: string[];
    success: boolean;
  }> {
    const { approvalResolutionRequestId, batchId, operationId, toolMessageIds, topicId } = params;

    const operation = await this.deps.agentOperationModel.findById(operationId);
    if (
      !operation ||
      operation.topicId !== topicId ||
      (operation.status !== 'waiting_for_human' && operation.status !== 'interrupted')
    ) {
      throw new Error('stopPendingApproval: operation is not the parked owner of this topic');
    }

    // Validate identity and complete sealed-batch membership before the atomic
    // claim. The caller cannot stop a hand-picked subset or a stale batch from
    // another parked operation.
    const targets: { alreadyClaimed: boolean; id: string }[] = [];
    for (const toolMessageId of toolMessageIds) {
      const message = await this.deps.messageModel.findById(toolMessageId);
      if (!message)
        throw new Error(`stopPendingApproval: tool message not found: ${toolMessageId}`);
      if (message.role !== 'tool') {
        throw new Error(
          `stopPendingApproval.toolMessageIds must point at role='tool' messages, got role='${message.role}'`,
        );
      }
      if (message.topicId !== topicId) {
        throw new Error('stopPendingApproval: topicId does not match the target tool message');
      }
      const plugin = await this.deps.messageModel.findMessagePlugin(toolMessageId);
      const intervention = plugin?.intervention;
      if (
        !intervention ||
        intervention.operationId !== operationId ||
        intervention.batchId !== batchId
      ) {
        throw new Error('stopPendingApproval: target is not in the requested batch');
      }
      const alreadyClaimed =
        intervention.status === 'aborted' &&
        Boolean(approvalResolutionRequestId) &&
        intervention.resolutionRequestId === approvalResolutionRequestId;
      if (intervention.status !== 'pending' && !alreadyClaimed) {
        throw new HumanApprovalAlreadyResolvedError(toolMessageId);
      }
      targets.push({ alreadyClaimed, id: toolMessageId });
    }

    const fullBatchIds = (await this.deps.messageModel.listMessagePluginsByTopic(topicId))
      .filter(
        (plugin) =>
          plugin.intervention?.operationId === operationId &&
          plugin.intervention?.batchId === batchId,
      )
      .map(({ id }) => id)
      .sort();
    const requestedIds = targets.map(({ id }) => id).sort();
    if (
      fullBatchIds.length !== requestedIds.length ||
      fullBatchIds.some((id, index) => id !== requestedIds[index])
    ) {
      throw new Error('stopPendingApproval: targets must cover the complete sealed batch');
    }

    const alreadyClaimedCount = targets.filter(({ alreadyClaimed }) => alreadyClaimed).length;
    if (alreadyClaimedCount !== 0 && alreadyClaimedCount !== targets.length) {
      throw new Error('stopPendingApproval: batch has a partial resolution claim');
    }
    if (operation.status === 'interrupted' && alreadyClaimedCount !== targets.length) {
      throw new Error('stopPendingApproval: interrupted operation has unsettled batch members');
    }

    if (alreadyClaimedCount === 0) {
      await this.deps.messageModel.resolveHumanApproval(
        targets.map((target) => ({
          content: STOPPED_TOOL_CONTENT,
          id: target.id,
          intervention: {
            ...(approvalResolutionRequestId && {
              resolutionRequestId: approvalResolutionRequestId,
            }),
            status: 'aborted',
          },
        })),
      );
    }

    // Read before the interrupt retires the runtime snapshot.
    const groupMember = await this.deps.agentRuntimeService.loadGroupMemberBridge(operationId);

    if (operation.status !== 'interrupted') {
      await this.deps.agentRuntimeService.interruptOperation(operationId);
      await this.deps.agentOperationModel.recordCompletion(operationId, {
        completedAt: new Date(),
        completionReason: 'interrupted',
        status: 'interrupted',
      });
    }

    // A group member stopped on its approval never reaches its own completion,
    // so its bridge never fires and the supervisor stays parked on the member
    // barrier. Report the stop through the bridge (idempotent: backfills and the
    // supervisor resume are CAS-guarded, so a retried stop is safe).
    if (groupMember) {
      await this.deps.agentRuntimeService.completeGroupActionMember({
        ...groupMember.bridge,
        operationId,
        reason: 'interrupted',
      });
    }

    log(
      'stopPendingApproval: settled %d tool message(s), retired operation %s',
      targets.length,
      operationId,
    );

    return {
      operationId,
      settledToolMessageIds: targets.map((t) => t.id),
      success: true,
    };
  }

  /**
   * Retire the operation segment that parked on an approval after its
   * replacement continuation has been scheduled. The Redis state is stopped
   * first; the durable row then converges waiting_for_human -> done. Repeating
   * this call is safe, including after Cloud supersession won the race.


    );

    return {
      operationId,
      settledToolMessageIds: targets.map((t) => t.id),
      success: true,
    };
  }

  /**
   * Retire the operation segment that parked on an approval after its
   * replacement continuation has been scheduled. The Redis state is stopped
   * first; the durable row then converges waiting_for_human -> done. Repeating
   * this call is safe, including after Cloud supersession won the race.
   */
  async retirePendingApprovalOperation(operationId: string): Promise<void> {
    await this.deps.agentRuntimeService.interruptOperation(operationId);

    const operation = await this.deps.agentOperationModel.findById(operationId);
    if (!operation) {
      throw new Error(`retirePendingApprovalOperation: operation not found: ${operationId}`);
    }
    if (operation.status === 'done' || operation.status === 'interrupted') return;
    if (operation.status !== 'waiting_for_human') {
      throw new Error(
        `retirePendingApprovalOperation: expected waiting_for_human, got ${operation.status}`,
      );
    }

    const completed = await this.deps.agentOperationModel.recordCompletion(operationId, {
      completedAt: new Date(),
      completionReason: 'done',
      status: 'done',
    });
    if (!completed) {
      const latest = await this.deps.agentOperationModel.findById(operationId);
      if (latest?.status !== 'done' && latest?.status !== 'interrupted') {
        throw new Error(`retirePendingApprovalOperation: failed to settle ${operationId}`);
      }
    }
  }

  /** Owner-scoped runtime state used by the v2 router's crash-safe retry probe. */
  async loadInterventionContinuationState(operationId: string): Promise<AgentState | null> {
    return this.deps.agentRuntimeService.loadInterventionContinuationState(operationId);
  }

  /** Requeue an idle deterministic continuation without rebuilding its assistant turn. */
  async ensureInterventionContinuationStarted(
    operationId: string,
  ): Promise<'already_started' | 'missing' | 'scheduled'> {
    return this.deps.agentRuntimeService.ensureInterventionContinuationStarted(operationId);
  }

  /**
   * Repair the topic reconnect marker and release the exact start reservation
   * after a durable queue ACK. A foreign newer running operation fails closed.
   */
  async repairInterventionContinuationTopicAnchor(params: {
    assistantMessageId: string;
    continuationOperationId: string;
    resolutionRequestId: string;
    scope?: string | null;
    sourceOperationId: string;
    sourceToolMessageIds: string[];
    threadId?: string | null;
    topicId: string;
  }): Promise<void> {
    const operation = await this.deps.agentOperationModel.findById(params.continuationOperationId);
    const expectedProvenance = {
      resolutionRequestId: params.resolutionRequestId,
      sourceOperationId: params.sourceOperationId,
      sourceToolMessageIds: [...params.sourceToolMessageIds].sort(),
    };
    const assistant = await this.deps.messageModel.findById(params.assistantMessageId);
    const dispatchMarker = operation?.metadata?.agentInterventionDispatch as
      | {
          deduplicationId?: unknown;
          resolutionRequestId?: unknown;
          state?: unknown;
        }
      | undefined;
    const expectedDeduplicationId = deriveAgentInterventionQueueDeduplicationId(
      params.continuationOperationId,
      0,
    );
    if (
      !operation ||
      operation.topicId !== params.topicId ||
      !matchesAgentInterventionContinuationProvenance(
        operation.metadata?.agentInterventionContinuation,
        expectedProvenance,
      ) ||
      dispatchMarker?.state !== 'scheduled' ||
      dispatchMarker.resolutionRequestId !== params.resolutionRequestId ||
      dispatchMarker.deduplicationId !== expectedDeduplicationId ||
      assistant?.role !== 'assistant' ||
      assistant.topicId !== params.topicId
    ) {
      throw new Error('Intervention continuation topic repair provenance conflict');
    }

    // Thread continuations use the deterministic topic reservation only as a
    // short single-initializer fence. They never own the topic's main
    // runningOperation anchor, so ACK recovery must release exactly their
    // reservation without promoting the thread into the main conversation
    // spine. A foreign reservation is intentionally left untouched.
    if (params.threadId) {
      const released = await this.deps.topicModel.releaseTaskCallbackReservation(
        params.topicId,
        params.continuationOperationId,
      );
      if (released === 'foreign') {
        throw new Error('Intervention continuation topic repair found a foreign reservation');
      }
      return;
    }

    const state = await this.deps.agentRuntimeService.loadInterventionContinuationState(
      params.continuationOperationId,
    );
    const runtimeTerminal =
      state?.status === 'done' || state?.status === 'error' || state?.status === 'interrupted';
    const durableTerminal =
      operation.status === 'done' ||
      operation.status === 'error' ||
      operation.status === 'interrupted' ||
      operation.status === 'abandoned';
    const result = await this.deps.topicModel.repairAgentInterventionContinuation({
      active: !runtimeTerminal && !durableTerminal,
      assistantMessageId: params.assistantMessageId,
      continuationOperationId: params.continuationOperationId,
      reservationId: params.continuationOperationId,
      scope: params.scope,
      sourceOperationId: params.sourceOperationId,
      startedAt: operation.startedAt?.toISOString() ?? new Date().toISOString(),
      threadId: params.threadId,
      topicId: params.topicId,
    });
    if (result === 'conflict') {
      throw new Error('Intervention continuation topic repair found a foreign running operation');
    }
  }

  private sandboxService(topicId: string) {
    return import('@/server/services/sandbox').then(async ({ createSandboxService }) =>
      createSandboxService({
        marketService: await this.deps.getMarketService(),
        purpose: 'coding',
        topicId,
        userId: this.deps.userId,
      }),
    );
  }

  private heteroService() {
    return new HeterogeneousAgentService(this.deps.db, this.deps.userId, {
      workspaceId: this.deps.workspaceId,
    });
  }

  /**
   * Stops a Claude Code / Codex run going on in the cloud sandbox: kills its background command
   * (the whole process group, so the CLI and the agent go together), then closes the run the way
   * a finished one closes, since the killed CLI never reports back: the stream ends, the
   * operation row becomes `interrupted`, the run's hooks fire and the topic is free again.
   * Returns false when the topic's current run is not one.
   */
  private async stopSandboxHeteroRun(topicId: string, operationId: string): Promise<boolean> {
    const topic = await this.deps.topicModel.findById(topicId);
    const run = topic?.metadata?.heteroSandboxRun;
    const running = topic?.metadata?.runningOperation;
    if (!run || run.operationId !== operationId || running?.operationId !== operationId) {
      return false;
    }

    log('stopSandboxHeteroRun: op=%s command=%s', operationId, run.commandId);
    // The run is closed as interrupted before its command is killed: the CLI still reports on its
    // way out, and finding the operation ended, that report changes nothing (see heteroFinish)
    await this.deps.topicModel.updateMetadata(topicId, {
      heteroSandboxRun: null,
      runningOperation: null,
    });
    await new CompletionLifecycle(this.deps.db, this.deps.userId, this.deps.workspaceId)
      .completeOperation(
        {
          agentId: parseOperationId(operationId)?.agentId,
          assistantMessageId: running.assistantMessageId,
          operationId,
          serializedHooks: running.hooks as SerializedHook[] | undefined,
          topicId,
          userId: this.deps.userId,
        },
        'interrupted',
      )
      .catch((error) => log('stopSandboxHeteroRun: completing the run failed: %O', error));

    const killed = await (
      await this.sandboxService(topicId)
    )
      .callTool('killCommand', { commandId: run.commandId })
      .catch((error: unknown) => ({ error, success: false }));
    // A command that already ended cannot be killed; the run is closed all the same
    if (!killed.success) log('stopSandboxHeteroRun: kill failed: %O', killed);

    // Flushes what was streamed and ends the stream; on `cancelled` it leaves the hooks alone
    await this.heteroService()
      .heteroFinish({ agentType: run.heteroType, operationId, result: 'cancelled', topicId })
      .catch((error) => log('stopSandboxHeteroRun: closing the stream failed: %O', error));
    // A question the stopped run asked no longer waits for an answer
    await abortHeteroInterventions(this.deps.db, this.deps.userId, operationId).catch((error) =>
      log('stopSandboxHeteroRun: releasing interventions failed: %O', error),
    );
    return true;
  }

  /**
   * Stops Claude Code / Codex members of a group conversation: the one asked for, or all of them
   * when the run stopped is the conversation's own (the host's). Each member's command is killed
   * and its run closed as interrupted. Returns whether the run asked for was a member's.
   */
  private async stopSandboxMemberRuns(topicId: string, operationId: string): Promise<boolean> {
    const topic = await this.deps.topicModel.findById(topicId);
    const all = topic?.metadata?.heteroMemberRuns ?? {};
    const isMember = operationId in all;
    if (!isMember && topic?.metadata?.runningOperation?.operationId !== operationId) return false;
    const members = Object.entries(all).filter(([id]) => !isMember || id === operationId);
    if (members.length === 0) return false;

    for (const [memberOperationId, member] of members) {
      log('stopSandboxMemberRuns: op=%s command=%s', memberOperationId, member.commandId);
      // Closed before the kill, as in stopSandboxHeteroRun, so the CLI's last report changes nothing
      await this.deps.topicModel.updateMetadataEntry(
        topicId,
        'heteroMemberRuns',
        memberOperationId,
        null,
      );
      await new CompletionLifecycle(this.deps.db, this.deps.userId, this.deps.workspaceId)
        .completeOperation(
          {
            agentId: member.agentId,
            assistantMessageId: member.assistantMessageId,
            operationId: memberOperationId,
            serializedHooks: member.hooks as SerializedHook[] | undefined,
            topicId,
            userId: this.deps.userId,
          },
          'interrupted',
        )
        .catch((error) => log('stopSandboxMemberRuns: completing failed: %O', error));
      if (member.commandId) {
        await (
          await this.sandboxService(topicId)
        )
          .callTool('killCommand', { commandId: member.commandId })
          .catch((error: unknown) => log('stopSandboxMemberRuns: kill failed: %O', error));
      }
      await this.heteroService()
        .heteroFinish({
          agentType: member.heteroType,
          operationId: memberOperationId,
          result: 'cancelled',
          topicId,
        })
        .catch((error) => log('stopSandboxMemberRuns: closing the stream failed: %O', error));
      await abortHeteroInterventions(this.deps.db, this.deps.userId, memberOperationId).catch(
        () => {},
      );
    }
    return isMember;
  }
}
