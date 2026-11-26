import type { Message } from 'chat';
import debug from 'debug';

import type { MessengerPlatform } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { MessageModel } from '@/database/models/message';
import type { SafeMessengerAccountLink } from '@/database/models/messengerAccountLink';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import type { LobeChatDatabase } from '@/database/type';
import { renderApprovalAnswered, renderApprovalReply } from '@/server/services/bot/replyTemplate';
import { answerToolApproval, ToolApprovalError } from '@/server/services/toolApproval';
import { describeApprovalCall } from '@/server/services/toolApproval/describe';

import { readApprovalReply } from '../approvalReply';
import type { InstallationCredentials } from '../installations/types';
import { messengerReplyLocale } from '../replies';
import { getMessengerSystemStrings } from '../systemReply';
import type { CallbackAcknowledgement, InboundCallbackAction } from '../types';

const log = debug('lobe-server:messenger:router');

/**
 * A message in a chat whose run waits for the sender's approval answers the oldest call waiting
 * there, the one the chat asked about: "1" approves, "2" rejects, and anything else refuses it
 * and passes the words on to the agent, so it can do what was asked instead. The sender's own
 * account bounds the lookup, so someone else's message in a shared chat never answers it.
 * Returns false when nothing waits here; the message then goes to the agent as usual.
 */
export async function answerApprovalByReply({
  link,
  message,
  platform,
  reply,
  serverDB,
  thread,
}: {
  link: SafeMessengerAccountLink;
  message: Message;
  platform: MessengerPlatform;
  reply: (text: string) => Promise<void>;
  serverDB: LobeChatDatabase;
  thread: any;
}): Promise<boolean> {
  const topicId: string | undefined = (await thread.state)?.topicId;
  if (!topicId) return false;

  const workspaceId = link.workspaceId ?? undefined;
  const pending = await new MessageModel(
    serverDB,
    link.userId,
    workspaceId,
  ).listPendingInterventions({ topicId });
  const call = pending.at(-1);
  if (!call) return false;

  const lng = messengerReplyLocale(platform);
  const answer = readApprovalReply(message.text);
  log('answerApprovalByReply: %s answers %s in topic=%s', answer, call.id, topicId);

  if (answer === 'unclear') {
    await reply(renderApprovalReply('toolApprovalReplyOnlyText', lng));
    return true;
  }

  const decision = answer === 'approved' ? 'approved' : 'rejected';
  try {
    await answerToolApproval(serverDB, {
      decision,
      reason: answer === 'other' ? message.text.trim() : undefined,
      toolMessageId: call.id,
      userId: link.userId,
      via: platform,
      workspaceId,
    });
  } catch (error) {
    if (!(error instanceof ToolApprovalError)) throw error;

    log('answerApprovalByReply: %s refused (%s)', call.id, error.code);
    await reply(
      renderApprovalReply(
        error.code === 'CONFLICT' ? 'toolApprovalAlreadyAnswered' : 'toolApprovalGone',
        lng,
      ),
    );
    return true;
  }

  const { title } = describeApprovalCall({
    apiName: call.apiName ?? 'tool',
    arguments: call.arguments,
    identifier: call.identifier,
  });
  await reply(renderApprovalAnswered({ decision, redirected: answer === 'other', title }, lng));
  return true;
}

/**
 * Handle a tap on Approve / Reject under a paused run's request
 * (`messenger:approve|reject:<toolMessageId>`). Only the linked sender can answer, and only
 * their own run's call: the tool message is looked up within their account. The answer goes
 * through the same path as the phone's, so whichever comes first wins; the tapped message keeps
 * the outcome as text and loses its buttons, and the resumed run edits its reply into it.
 */
export async function handleApprovalCallback(
  creds: InstallationCredentials,
  action: InboundCallbackAction,
  decision: 'approved' | 'rejected',
  toolMessageId: string,
  ack: (ack: CallbackAcknowledgement) => Promise<void>,
): Promise<void> {
  const lng = messengerReplyLocale(creds.platform);
  const serverDB = await getServerDB();
  const link = await MessengerAccountLinkModel.findByPlatformUser(
    serverDB,
    creds.platform,
    action.fromUserId,
    creds.tenantId,
  );
  if (!link) {
    await ack({ toast: getMessengerSystemStrings(creds.platform).notLinked });
    return;
  }

  try {
    await answerToolApproval(serverDB, {
      chatMessageId: action.messageId === undefined ? undefined : String(action.messageId),
      decision,
      toolMessageId,
      userId: link.userId,
      via: creds.platform,
      workspaceId: link.workspaceId ?? undefined,
    });
  } catch (error) {
    if (!(error instanceof ToolApprovalError)) throw error;

    const key = error.code === 'CONFLICT' ? 'toolApprovalAlreadyAnswered' : 'toolApprovalGone';
    log('handleApprovalCallback: %s refused (%s)', toolMessageId, error.code);
    await ack({
      replaceText: renderApprovalReply(key, lng),
      toast: renderApprovalReply(key, lng),
    });
    return;
  }

  const outcome = renderApprovalReply(
    decision === 'approved' ? 'toolApprovalApproved' : 'toolApprovalRejected',
    lng,
  );
  await ack({ replaceText: outcome, toast: outcome });
}
