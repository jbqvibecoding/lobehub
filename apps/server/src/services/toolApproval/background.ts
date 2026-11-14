import type { UserInterventionConfig, UserToolConfig } from '@lobechat/types';

import { PushTokenModel } from '@/database/models/pushToken';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

/**
 * How a run nobody is watching (a task, a scheduled or recurring run, an API call) treats a tool
 * that asks for approval.
 *
 * With a phone registered, the phone is where approvals go: the run pauses, the phone is told,
 * and the answer resumes it. Such a run follows the approval mode the user saved for chats
 * (manual by default), so a tool they chose to always allow still runs without asking. Without a
 * phone there is nobody to ask, and the run stays headless as before: tools that ask run, and
 * sensitive third-party actions are refused.
 */
export const backgroundInterventionConfig = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<UserInterventionConfig> => {
  const phones = await new PushTokenModel(db, userId).listByUserId();
  if (phones.length === 0) return { approvalMode: 'headless' };

  const saved = (
    (await new UserModel(db, userId).getUserSettings())?.tool as UserToolConfig | undefined
  )?.humanIntervention;
  const approvalMode =
    saved?.approvalMode && saved.approvalMode !== 'headless' ? saved.approvalMode : 'manual';
  return saved?.allowList?.length ? { allowList: saved.allowList, approvalMode } : { approvalMode };
};

/** How long a background run waits for an answer before the request counts as refused. */
export const BACKGROUND_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The `topic.trigger` of conversations started by runs nobody is watching: tasks, scheduled runs,
 * API calls and the command line. Requests in these expire; requests in chats wait for the user.
 */
export const BACKGROUND_TOPIC_TRIGGERS = ['task', 'cron', 'api', 'openapi', 'cli'] as const;
