import { NativeTabs } from 'expo-router/native-tabs';

import { usePendingApprovals } from '@/features/approvals/use-approvals';
import { t } from '@/i18n/strings';
import { api } from '@/lib/api';

export default function TabsLayout() {
  const { data: pending } = usePendingApprovals(api);
  const waiting = pending?.length ?? 0;

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(approvals)">
        <NativeTabs.Trigger.Icon md="verified_user" sf="checkmark.shield" />
        <NativeTabs.Trigger.Label>{t('approvalsTitle')}</NativeTabs.Trigger.Label>
        {waiting > 0 ? (
          <NativeTabs.Trigger.Badge>{String(waiting)}</NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(activity)">
        <NativeTabs.Trigger.Icon md="history" sf="clock.arrow.circlepath" />
        <NativeTabs.Trigger.Label>{t('activityTitle')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
