import type { ChatToolPayload } from '@lobechat/types';
import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import { NotificationModel } from '@/database/models/notification';
import type { LobeChatDatabase } from '@/database/type';

import { PushChannel } from '../push/PushChannel';
import { describeApprovalCall } from '../toolApproval/describe';

const log = debug('lobe-server:approval-notification');

type PendingTool = Pick<ChatToolPayload, 'apiName' | 'id' | 'identifier'>;

/**
 * Each pending tool call gets its own inbox row under this key, so answering a call (from the
 * phone or the web) clears exactly that row, and a retried step cannot notify twice.
 */
export const toolApprovalDedupeKey = (toolCallId: string) => `tool-approval:${toolCallId}`;

/**
 * The phone's notification category for a single waiting call: Approve and Reject buttons, which
 * answer the call named by the push's `data.toolMessageId`.
 */
export const APPROVAL_PUSH_CATEGORY = 'approval';

/**
 * Tells the user that a run paused for them: an inbox row per pending call, and one push to their
 * phones for the whole pause. The push names the actions, never their arguments, because it
 * passes through Expo, APNs and FCM. When the pause waits on a single call, the push carries
 * Approve and Reject buttons for it; with several, tapping it opens the list.
 */
export const notifyPendingApprovals = async (
  db: LobeChatDatabase,
  {
    actions = true,
    agentId,
    pendingTools,
    topicId,
    userId,
    workspaceId,
  }: {
    /** Approve and Reject buttons on a single call's push; off for a question that needs words */
    actions?: boolean;
    agentId?: string;
    pendingTools: PendingTool[];
    topicId?: string;
    userId: string;
    workspaceId?: string;
  },
  push: Pick<PushChannel, 'deliver'> = new PushChannel(),
) => {
  const model = new NotificationModel(db, userId);
  const actionUrl = agentId ? `/agent/${agentId}${topicId ? `/${topicId}` : ''}` : undefined;

  const created: { id: string; tool: PendingTool }[] = [];
  for (const tool of pendingTools) {
    const row = await model.create({
      actionUrl,
      category: 'agent',
      content: describeTool(tool),
      dedupeKey: toolApprovalDedupeKey(tool.id),
      title: TEXT.en.title,
      type: 'tool_approval_required',
    });
    if (row) created.push({ id: row.id, tool });
  }

  if (created.length === 0) {
    log('pause already notified (userId=%s, calls=%d)', userId, pendingTools.length);
    return;
  }

  const notificationId = created[0].id;
  const tools = created.map(({ tool }) => tool);
  const toolMessageId =
    tools.length === 1 && topicId
      ? await findToolMessageId(db, { toolCallId: tools[0].id, topicId, userId, workspaceId })
      : undefined;
  const result = await push.deliver({
    actionUrl,
    ...(toolMessageId && actions && { categoryId: APPROVAL_PUSH_CATEGORY }),
    // `kind` tells the phone this is an approval, unlike routine results and proactive messages
    data: { kind: 'approval', ...(toolMessageId && { toolMessageId }) },
    content: TEXT.en.summary(tools),
    notificationId,
    title: TEXT.en.title,
    translations: { zh: { content: TEXT.zh.summary(tools), title: TEXT.zh.title } },
    userId,
  });

  log('push for %d pending call(s): %s %s', tools.length, result.status, result.failedReason ?? '');

  // Without a registered phone nothing was attempted, so there is no delivery to reconcile
  if (result.failedReason === 'no_tokens') return;

  await model.createDelivery({
    channel: 'push',
    failedReason: result.failedReason,
    notificationId,
    providerMessageId: result.providerMessageId,
    sentAt: result.status === 'sent' ? new Date() : undefined,
    status: result.status,
  });
};

const TEXT = {
  en: {
    summary: (tools: PendingTool[]) =>
      tools.length === 1
        ? describeTool(tools[0])
        : `${describeTool(tools[0])}, and ${tools.length - 1} more`,
    title: 'Waiting for you',
  },
  zh: {
    summary: (tools: PendingTool[]) =>
      tools.length === 1
        ? describeTool(tools[0])
        : `${describeTool(tools[0])} 等 ${tools.length} 项操作`,
    title: '等你处理',
  },
};

const describeTool = (tool: PendingTool) => describeApprovalCall(tool).title;

/** The tool message the phone answers, for a call the runtime knows by its call id. */
const findToolMessageId = async (
  db: LobeChatDatabase,
  {
    toolCallId,
    topicId,
    userId,
    workspaceId,
  }: { toolCallId: string; topicId: string; userId: string; workspaceId?: string },
) => {
  const pending = await new MessageModel(db, userId, workspaceId).listPendingInterventions({
    topicId,
  });
  return pending.find((call) => call.toolCallId === toolCallId)?.id;
};
