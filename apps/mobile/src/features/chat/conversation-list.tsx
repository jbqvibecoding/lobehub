import { Link } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { t } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import { AgentAvatar } from './agent-avatar';
import type { RecentConversation } from './types';
import { useConversations } from './use-chat';

/** Member avatars shown on a group row, at most */
const GROUP_AVATARS = 4;

/** Who a conversation is with, as its row names them. */
const withWhom = (conversation: RecentConversation) =>
  conversation.type === 'group'
    ? conversation.group?.title || t('chatGroupFallbackTitle')
    : (conversation.agent?.title ?? 'Biber');

const formatWhen = (date: Date) =>
  new Date(date).toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  });

/**
 * Recent chats with Biber, the user's experts and their group chats, newest first, and a way to
 * start a new one.
 */
export const ConversationList = ({ api }: { api: ApiClient }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const { data, error, isFetching, isLoading, refetch } = useConversations(api);

  const newChat = (
    <Link asChild href="/chat/start">
      <Pressable role="button" style={styles.newChat}>
        <Text style={styles.newChatLabel}>{t('chatNew')}</Text>
      </Pressable>
    </Link>
  );

  const emptyState = () => {
    if (data) return <Text style={styles.message}>{t('chatEmpty')}</Text>;
    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('chatError')}</Text>
          <Pressable onPress={() => refetch()} role="button">
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return <ActivityIndicator style={styles.centered} />;
  };

  return (
    <FlatList
      contentContainerStyle={styles.list}
      contentInsetAdjustmentBehavior="automatic"
      data={data ?? []}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={emptyState}
      ListHeaderComponent={
        <>
          {newChat}
          {error && data ? <Text style={styles.inlineError}>{t('chatRefreshError')}</Text> : null}
        </>
      }
      refreshControl={
        <RefreshControl
          onRefresh={() => {
            refetch();
          }}
          refreshing={isFetching && !isLoading}
        />
      }
      renderItem={({ item }) => (
        <Link asChild href={{ params: { topicId: item.id }, pathname: '/chat/[topicId]' }}>
          <Pressable role="button" style={styles.row}>
            <View style={styles.rowHeader}>
              <View style={styles.who}>
                {item.type === 'group' ? (
                  <View style={styles.avatars}>
                    {(item.group?.members ?? []).slice(0, GROUP_AVATARS).map((member, index) => (
                      <AgentAvatar
                        avatar={member.avatar}
                        backgroundColor={member.backgroundColor}
                        key={index}
                        size={18}
                        title={index === 0 ? 'Biber' : '?'}
                      />
                    ))}
                  </View>
                ) : null}
                <Text numberOfLines={1} style={styles.agent}>
                  {withWhom(item)}
                </Text>
              </View>
              <Text style={styles.when}>{formatWhen(item.updatedAt)}</Text>
            </View>
            <Text numberOfLines={2} style={styles.title}>
              {item.title || t('chatUntitled')}
            </Text>
          </Pressable>
        </Link>
      )}
      style={styles.screen}
    />
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    agent: { color: colors.secondaryLabel, flexShrink: 1, fontSize: 13 },
    avatars: { flexDirection: 'row', gap: 2 },
    centered: { alignItems: 'center', gap: 12, marginTop: 48 },
    inlineError: { color: colors.danger, fontSize: 14, marginBottom: 12 },
    link: { color: colors.accent, fontSize: 16 },
    list: { flexGrow: 1, padding: 16 },
    message: {
      color: colors.secondaryLabel,
      fontSize: 16,
      lineHeight: 22,
      marginTop: 48,
      textAlign: 'center',
    },
    newChat: {
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: 12,
      marginBottom: 16,
      minHeight: 44,
      justifyContent: 'center',
    },
    newChatLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
    row: { backgroundColor: colors.card, borderRadius: 12, padding: 14 },
    rowHeader: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
    screen: { backgroundColor: colors.background, flex: 1 },
    separator: { height: 8 },
    title: { color: colors.label, fontSize: 16, fontWeight: '600', marginTop: 4 },
    when: { color: colors.secondaryLabel, fontSize: 13 },
    who: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: 6 },
  });
