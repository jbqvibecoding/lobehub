import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { activityKey } from '@/features/activity/use-activity';
import { pendingApprovalsKey } from '@/features/approvals/use-approvals';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Every notification Biber sends is about something waiting for the user, so a notification
 * refreshes the list and a tap opens it.
 */
export const useNotificationRouting = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const refresh = () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: pendingApprovalsKey }),
        queryClient.invalidateQueries({ queryKey: activityKey }),
      ]);

    const received = Notifications.addNotificationReceivedListener(refresh);
    const tapped = Notifications.addNotificationResponseReceivedListener(() => {
      refresh();
      router.navigate('/');
    });

    return () => {
      received.remove();
      tapped.remove();
    };
  }, [queryClient]);
};
