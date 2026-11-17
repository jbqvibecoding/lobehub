import * as Notifications from 'expo-notifications';

import { confirmWithBiometrics } from '@/features/approvals/confirm-with-biometrics';
import type { ApprovalDecision, PendingApproval } from '@/features/approvals/types';
import { t } from '@/i18n/strings';

/**
 * Approve and Reject on the notification of a run waiting on one call. The server names this
 * category on such a push (`APPROVAL_PUSH_CATEGORY`) and puts the call's id in `data`.
 *
 * Both buttons open the app, which then answers: an iPhone does not wake an app that was swiped
 * away for a button that stays in the background, so the tap would be lost. Approving from the
 * lock screen first unlocks the phone, and the app still asks for Face ID as the card does.
 */
export const APPROVAL_CATEGORY = 'approval';
export const APPROVE_ACTION = 'approve';
export const REJECT_ACTION = 'reject';

export const registerApprovalCategory = () =>
  Notifications.setNotificationCategoryAsync(APPROVAL_CATEGORY, [
    {
      buttonTitle: t('approve'),
      identifier: APPROVE_ACTION,
      options: { isAuthenticationRequired: true, opensAppToForeground: true },
    },
    {
      buttonTitle: t('reject'),
      identifier: REJECT_ACTION,
      options: { isDestructive: true, opensAppToForeground: true },
    },
  ]);

export interface NotificationAnswer {
  decision: ApprovalDecision;
  /** The action as the notification named it, for the notice after answering */
  title: string;
  toolMessageId: string;
}

/** The answer a tap on Approve or Reject carries; null for a tap on the notification itself. */
export const readNotificationAnswer = (
  response: Notifications.NotificationResponse,
): NotificationAnswer | null => {
  const decision =
    response.actionIdentifier === APPROVE_ACTION
      ? 'approved'
      : response.actionIdentifier === REJECT_ACTION
        ? 'rejected'
        : null;
  const { body, data } = response.notification.request.content;
  const toolMessageId = data?.toolMessageId;
  if (!decision || typeof toolMessageId !== 'string') return null;

  return { decision, title: body ?? '', toolMessageId };
};

export type NotificationAnswerOutcome = 'alreadyAnswered' | 'answered' | 'cancelled' | 'failed';

/**
 * Answers the way the card does: approving asks for Face ID first, and an answer another device
 * gave first is reported, not treated as a failure.
 */
export const answerFromNotification = async (
  answer: NotificationAnswer,
  respond: (input: {
    decision: ApprovalDecision;
    toolMessageId: string;
  }) => Promise<{ alreadyAnswered: boolean }>,
): Promise<NotificationAnswerOutcome> => {
  if (answer.decision === 'approved' && !(await confirmWithBiometrics(t('approvePrompt')))) {
    return 'cancelled';
  }
  try {
    const { alreadyAnswered } = await respond({
      decision: answer.decision,
      toolMessageId: answer.toolMessageId,
    });
    return alreadyAnswered ? 'alreadyAnswered' : 'answered';
  } catch {
    return 'failed';
  }
};

/**
 * Keeps the notification tray in step with what still waits: a notification whose call was
 * answered (here, on the web, in a chat, or by timeout) goes away, all of them go once nothing
 * waits, and the app icon's badge shows the count.
 */
export const syncNotificationTray = async (pending: Pick<PendingApproval, 'id'>[]) => {
  if (pending.length === 0) {
    await Notifications.dismissAllNotificationsAsync();
  } else {
    const waiting = new Set(pending.map((item) => item.id));
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((notification) => {
          const id = notification.request.content.data?.toolMessageId;
          return typeof id === 'string' && !waiting.has(id);
        })
        .map((notification) =>
          Notifications.dismissNotificationAsync(notification.request.identifier),
        ),
    );
  }
  await Notifications.setBadgeCountAsync(pending.length);
};
