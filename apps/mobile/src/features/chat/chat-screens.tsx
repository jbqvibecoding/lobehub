import { Link, router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Pressable, Text } from 'react-native';

import { t } from '@/i18n/strings';
import { api } from '@/lib/api';
import { useColors } from '@/theme/colors';

import { Conversation } from './conversation';
import { ConversationList } from './conversation-list';
import { GroupMembers } from './group-members';
import { StartChat } from './start-chat';
import { useChatHistory, useGroup } from './use-chat';

export const ConversationListScreen = () => (
  <>
    <Stack.Screen options={{ title: t('chatTitle') }} />
    <ConversationList api={api} />
  </>
);

/** `/chat/start`: pick who a new chat is with, then open it. */
export const StartChatScreen = () => (
  <>
    <Stack.Screen options={{ title: t('chatNew') }} />
    <StartChat
      api={api}
      onOpenExperts={() => router.push('/experts')}
      onStart={(target) =>
        router.replace({
          params:
            target.kind === 'group'
              ? { groupId: target.groupId, title: target.title, topicId: 'new' }
              : {
                  title: target.title,
                  topicId: 'new',
                  ...(target.agentId && { agentId: target.agentId }),
                },
          pathname: '/chat/[topicId]',
        })
      }
    />
  </>
);

/**
 * `/chat/new` starts a chat with Biber, with the agent in `agentId` (an expert), or in the group
 * chat in `groupId`; once its first message is sent, it becomes that chat. A group chat's header
 * leads to its members.
 */
export const ConversationScreen = () => {
  const colors = useColors();
  const {
    agentId,
    groupId: newGroupId,
    title,
    topicId,
  } = useLocalSearchParams<{
    agentId?: string;
    groupId?: string;
    title?: string;
    topicId: string;
  }>();
  const isNew = topicId === 'new';
  const history = useChatHistory(api, isNew ? undefined : topicId, { poll: false });
  const groupId = history.data?.groupId ?? (isNew ? newGroupId : undefined);
  const group = useGroup(api, groupId);

  const heading = () => {
    if (groupId) return group.data?.title ?? title ?? t('chatGroupFallbackTitle');
    if (isNew) return title ?? t('chatNew');
    const withAgent = history.data?.agentId;
    return (withAgent && history.data?.speakers?.[withAgent]?.title) || '';
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: groupId
            ? () => (
                <Link asChild href={{ params: { groupId }, pathname: '/chat/members' }}>
                  <Pressable hitSlop={8} role="button">
                    <Text style={{ color: colors.accent, fontSize: 16 }}>{t('chatMembers')}</Text>
                  </Pressable>
                </Link>
              )
            : undefined,
          title: heading(),
        }}
      />
      <Conversation
        agentId={isNew ? agentId : undefined}
        api={api}
        groupId={isNew ? newGroupId : undefined}
        onStarted={(started) =>
          router.replace({ params: { topicId: started }, pathname: '/chat/[topicId]' })
        }
        title={isNew ? title : undefined}
        topicId={isNew ? undefined : topicId}
      />
    </>
  );
};

/** `/chat/members?groupId=…`: who is in a group chat. */
export const GroupMembersScreen = () => {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();

  return (
    <>
      <Stack.Screen options={{ title: t('chatMembers') }} />
      <GroupMembers api={api} groupId={groupId} />
    </>
  );
};
