import { useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';

import { t } from '@/i18n/strings';
import { api } from '@/lib/api';

import { TaskBoard } from './task-board';
import { TaskDetailView } from './task-detail';

export const TaskBoardScreen = () => (
  <>
    <Stack.Screen options={{ title: t('tasksTitle') }} />
    <TaskBoard api={api} />
  </>
);

export const TaskDetailScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <TaskDetailView api={api} id={id} />
    </>
  );
};
