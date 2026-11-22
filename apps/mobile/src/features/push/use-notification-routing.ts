import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { activityKey } from '@/features/activity/use-activity';
import { showApprovalNotice } from '@/features/approvals/approval-notice';
import { pendingApprovalsKey, useRespondToApproval } from '@/features/approvals/use-approvals';
import { t, tf } from '@/i18n/strings';
import { api } from '@/lib/api';

import {
  answerFromNotification,
  type NotificationAnswer,
  type NotificationAnswerOutcome,
  readNotificationAnswer,
  registerApprovalCategory,
} from './notification-answer';
import {
  type ProactiveTap,
  readProactiveTap,
  registerProactiveCategory,
} from './proactive-notification';

/** Tells the server what the user did with a message Biber sent unprompted; best effort. */
const reportProactiveTap = (tap: ProactiveTap) =>
  api
    .mutation(tap.report === 'dismiss' ? 'proactive.dismiss' : 'proactive.opened', {
      id: tap.outcomeId,
    })
    .catch(() => undefined);

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Each tap is answered once, though a cold start can report it both as the last response and to
 * the listener.
 */
const handledResponses = new Set<string>();

const noticeFor = (answer: NotificationAnswer, outcome: NotificationAnswerOutcome) => {
  switch (outcome) {
    case 'answered': {
      return tf(answer.decision === 'approved' ? 'notificationApproved' : 'notificationRejected', {
        title: answer.title,
      });
    }
    case 'alreadyAnswered': {
      return t('alreadyAnswered');
    }
    case 'failed': {
      return t('respondError');
    }
    case 'cancelled': {
      return null;
    }
  }
};

/**
 * A notification refreshes the approvals and activity lists. A tap on an approval opens the list,
 * and a tap on Approve or Reject also answers the call. A tap on Biber asking for help on its cloud
 * computer opens the cloud computer. A tap on a routine result or a message
 * Biber sent unprompted opens its task or chat and reports the open; "Not now" reports that the
 * message was unwanted. Answers and reports go out once the user is known to be signed in;
 * signed out, the tap only opens the app.
 *
 * `signedIn` is undefined while the stored session loads: taps wait for it.
 */
export const useNotificationRouting = (signedIn: boolean | undefined) => {
  const queryClient = useQueryClient();
  const respond = useRespondToApproval(api);
  const waiting = useRef<NotificationAnswer[]>([]);
  const waitingReports = useRef<ProactiveTap[]>([]);
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;
  const respondRef = useRef(respond.mutateAsync);
  respondRef.current = respond.mutateAsync;

  useEffect(() => {
    registerApprovalCategory().catch(() => undefined);
    registerProactiveCategory().catch(() => undefined);

    const refresh = () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: pendingApprovalsKey }),
        queryClient.invalidateQueries({ queryKey: activityKey }),
      ]);

    const answer = async (pendingAnswer: NotificationAnswer) => {
      const outcome = await answerFromNotification(pendingAnswer, respondRef.current);
      showApprovalNotice(noticeFor(pendingAnswer, outcome));
    };

    const handle = (response: Notifications.NotificationResponse) => {
      const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (handledResponses.has(key)) return;
      handledResponses.add(key);

      refresh();

      const proactive = readProactiveTap(response);
      if (proactive) {
        if (proactive.href) router.navigate(proactive.href);
        if (signedInRef.current === undefined) waitingReports.current.push(proactive);
        else if (signedInRef.current) reportProactiveTap(proactive);
        return;
      }

      // Biber asking for the user on its cloud computer: open it there
      if (response.notification.request.content.data?.kind === 'computer') {
        router.navigate('/computer');
        return;
      }

      router.navigate('/');

      const tapped = readNotificationAnswer(response);
      if (!tapped) return;
      if (signedInRef.current === undefined) waiting.current.push(tapped);
      else if (signedInRef.current) answer(tapped);
    };

    // A tap that launched the app arrives before any listener could hear it
    const launchedBy = Notifications.getLastNotificationResponse();
    if (launchedBy) {
      handle(launchedBy);
      Notifications.clearLastNotificationResponse();
    }

    const received = Notifications.addNotificationReceivedListener(refresh);
    const tapped = Notifications.addNotificationResponseReceivedListener(handle);

    return () => {
      received.remove();
      tapped.remove();
    };
  }, [queryClient]);

  // Taps that came in while the session was loading are answered once it has, or dropped
  useEffect(() => {
    if (signedIn === undefined) return;
    const answers = waiting.current.splice(0);
    const reports = waitingReports.current.splice(0);
    if (!signedIn) return;
    for (const report of reports) reportProactiveTap(report);
    for (const pendingAnswer of answers) {
      answerFromNotification(pendingAnswer, respondRef.current).then((outcome) =>
        showApprovalNotice(noticeFor(pendingAnswer, outcome)),
      );
    }
  }, [signedIn]);
};
