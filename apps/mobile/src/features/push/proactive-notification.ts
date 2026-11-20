import * as Notifications from 'expo-notifications';
import type { Href } from 'expo-router';

import { t } from '@/i18n/strings';

/**
 * What Biber sends unprompted: a routine's result or a message of its own. The server names this
 * category on such a push (`PROACTIVE_PUSH_CATEGORY`) and puts the ledger entry's id in `data`.
 *
 * "Not now" stays in the background: it only tells Biber the message was unwanted. An iPhone may
 * drop that tap when the app was swiped away; the message then counts as ignored a day later,
 * which says much the same.
 */
export const PROACTIVE_CATEGORY = 'proactive';
export const NOT_NOW_ACTION = 'not-now';

export const registerProactiveCategory = () =>
  Notifications.setNotificationCategoryAsync(PROACTIVE_CATEGORY, [
    {
      buttonTitle: t('notNow'),
      identifier: NOT_NOW_ACTION,
      options: { opensAppToForeground: false },
    },
  ]);

export interface ProactiveTap {
  /** Where the tap leads: the routine's task or the chat; none for "Not now" */
  href: Href | null;
  /** The ledger entry the phone reports on */
  outcomeId: string;
  report: 'dismiss' | 'opened';
}

/** A tap on a routine result or a proactive message; null for approvals and anything else. */
export const readProactiveTap = (
  response: Notifications.NotificationResponse,
): ProactiveTap | null => {
  const data = response.notification.request.content.data ?? {};
  const { kind, outcomeId, taskId, topicId } = data;
  if ((kind !== 'routine' && kind !== 'proactive') || typeof outcomeId !== 'string') return null;

  if (response.actionIdentifier === NOT_NOW_ACTION) {
    return { href: null, outcomeId, report: 'dismiss' };
  }

  const href: Href =
    kind === 'routine' && typeof taskId === 'string'
      ? { params: { id: taskId }, pathname: '/tasks/[id]' }
      : kind === 'proactive' && typeof topicId === 'string'
        ? { params: { topicId }, pathname: '/chat/[topicId]' }
        : '/';

  return { href, outcomeId, report: 'opened' };
};
