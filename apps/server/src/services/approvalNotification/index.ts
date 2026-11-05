import type { ChatToolPayload } from '@lobechat/types';
import debug from 'debug';

import { NotificationModel } from '@/database/models/notification';
import type { LobeChatDatabase } from '@/database/type';

import { PushChannel } from '../push/PushChannel';

const log = debug('lobe-server:approval-notification');

type PendingTool = Pick<ChatToolPayload, 'apiName' | 'id' | 'identifier'>;

/**
 * Each pending tool call gets its own inbox row under this key, so answering a call (from the
 * phone or the web) clears exactly that row, and a retried step cannot notify twice.
 */
export const toolApprovalDedupeKey = (toolCallId: string) => `tool-approval:${toolCallId}`;

/**
 * Tells the user that a run paused for them: an inbox row per pending call, and one push to their
 * phones for the whole pause. The push names the actions, never their arguments, because it
 * passes through Expo, APNs and FCM.
 */
export const notifyPendingApprovals = async (
  db: LobeChatDatabase,
  {
    agentId,
    pendingTools,
    topicId,
    userId,
  }: { agentId?: string; pendingTools: PendingTool[]; topicId?: string; userId: string },
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
  const result = await push.deliver({
    actionUrl,
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

const describeTool = ({ apiName, identifier }: PendingTool) => {
  const words = apiName
    .replaceAll(/([a-z\d])([A-Z])/g, '$1 $2')
    .replaceAll(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  const action = words ? words[0].toUpperCase() + words.slice(1) : apiName;

  return identifier ? `${action} · ${identifier}` : action;
};
