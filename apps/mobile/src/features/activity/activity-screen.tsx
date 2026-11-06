import { Stack } from 'expo-router/stack';

import { t } from '@/i18n/strings';
import { api } from '@/lib/api';

import { ActivityList } from './activity-list';

export const ActivityScreen = () => (
  <>
    <Stack.Screen options={{ title: t('activityTitle') }} />
    <ActivityList api={api} />
  </>
);
