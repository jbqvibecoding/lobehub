import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';

import { BACKGROUND_APPROVAL_TTL_MS, BACKGROUND_TOPIC_TRIGGERS } from './background';
import { answerToolApproval, ToolApprovalError } from './index';

const log = debug('lobe-server:tool-approval:expire');

/** What the agent is told when a request it made in the background went unanswered. */
export const NO_ANSWER_REASON =
  'Nobody answered this approval request in time, so the action was not taken.';

/**
 * Refuses approval requests that background runs (tasks, scheduled runs, API calls) have waited on
 * for longer than `BACKGROUND_APPROVAL_TTL_MS`. The refusal resumes each run the way a "No" from
 * the phone does: the agent is told the action was not taken and carries on, and a task's run
 * settles, so the next scheduled tick can start it again. Chats are left alone; the user is there.
 */
export const expireBackgroundApprovals = async (db: LobeChatDatabase, now = new Date()) => {
  const stale = await MessageModel.listStalePendingInterventions(db, {
    before: new Date(now.getTime() - BACKGROUND_APPROVAL_TTL_MS),
    triggers: BACKGROUND_TOPIC_TRIGGERS,
  });

  let expired = 0;
  let failed = 0;
  for (const { id, userId, workspaceId } of stale) {
    try {
      await answerToolApproval(db, {
        decision: 'rejected',
        reason: NO_ANSWER_REASON,
        toolMessageId: id,
        userId,
        via: 'timeout',
        workspaceId,
      });
      expired += 1;
    } catch (error) {
      // Answered between the query and now; nothing left to do
      if (error instanceof ToolApprovalError && error.code === 'CONFLICT') continue;
      // A request with no run to resume is closed as refused, so later sweeps do not retry it
      if (error instanceof ToolApprovalError) {
        await new MessageModel(db, userId, workspaceId).claimPendingIntervention(id, 'rejected');
      }
      failed += 1;
      console.error('[tool-approval:expire] could not expire %s: %O', id, error);
    }
  }

  log('found %d stale request(s): %d expired, %d failed', stale.length, expired, failed);
  return { expired, failed, found: stale.length };
};
