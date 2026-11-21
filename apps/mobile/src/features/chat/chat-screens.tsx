import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';

import { t } from '@/i18n/strings';
import { api } from '@/lib/api';

import { Conversation } from './conversation';
import { ConversationList } from './conversation-list';

export const ConversationListScreen = () => (
  <>
    <Stack.Screen options={{ title: t('chatTitle') }} />
    <ConversationList api={api} />
  </>
);

/**
 * `/chat/new` starts a chat with Biber, or with the agent in `agentId` (an expert); once its first
 * message is sent, it becomes that chat.
 */
export const ConversationScreen = () => {
  const { agentId, title, topicId } = useLocalSearchParams<{
    agentId?: string;
    title?: string;
    topicId: string;
  }>();
  const isNew = topicId === 'new';

  return (
    <>
      <Stack.Screen options={{ title: isNew ? (title ?? t('chatNew')) : '' }} />
      <Conversation
        agentId={isNew ? agentId : undefined}
        api={api}
        onStarted={(started) =>
          router.replace({ params: { topicId: started }, pathname: '/chat/[topicId]' })
        }
        topicId={isNew ? undefined : topicId}
      />
    </>
  );
};
