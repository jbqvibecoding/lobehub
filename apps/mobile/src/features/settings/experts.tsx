import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getLocales } from 'expo-localization';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { conversationsKey } from '@/features/chat/use-chat';
import { t, tf } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import type { Expert } from './types';
import { expertsKey, useExperts } from './use-experts';

/**
 * The expert roster: specialists the user can add to their team with a tap, chat with on their
 * own, or bring into a group chat with Biber. Removing one deletes the chats with them.
 */
export const ExpertsView = ({ api }: { api: ApiClient }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const locale = getLocales()[0]?.languageTag;

  const { data, error, isFetching, isLoading, refetch } = useExperts(api);

  const change = useMutation({
    mutationFn: ({ add, id }: { add: boolean; id: string }) =>
      add ? api.mutation('experts.add', { id, locale }) : api.mutation('experts.remove', { id }),
    onError: () => setFailed(true),
    onMutate: () => setFailed(false),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: expertsKey }),
        queryClient.invalidateQueries({ queryKey: conversationsKey }),
      ]),
  });

  const confirmRemove = (expert: Expert) =>
    Alert.alert(tf('expertRemoveTitle', { name: expert.title }), t('expertRemoveBody'), [
      { style: 'cancel', text: t('cancel') },
      {
        onPress: () => change.mutate({ add: false, id: expert.id }),
        style: 'destructive',
        text: t('expertRemove'),
      },
    ]);

  const emptyState = () => {
    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('expertsError')}</Text>
          <Pressable accessibilityRole="button" onPress={() => refetch()}>
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return isLoading ? <ActivityIndicator style={styles.centered} /> : null;
  };

  const renderExpert = ({ item }: { item: Expert }) => (
    <View style={styles.card}>
      <View style={styles.row}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.avatar, { backgroundColor: item.backgroundColor }]}
        >
          <Text style={styles.avatarText}>{item.avatar}</Text>
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.description}>{item.description}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        {item.agentId ? (
          <>
            <Pressable
              accessibilityLabel={tf('expertChatWith', { name: item.title })}
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  params: { agentId: item.agentId!, title: item.title, topicId: 'new' },
                  pathname: '/chat/[topicId]',
                })
              }
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryText}>{t('expertChat')}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={tf('expertRemoveTitle', { name: item.title })}
              accessibilityRole="button"
              disabled={change.isPending}
              onPress={() => confirmRemove(item)}
              style={styles.secondary}
            >
              <Text style={styles.danger}>{t('expertRemove')}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            accessibilityLabel={tf('expertAddNamed', { name: item.title })}
            accessibilityRole="button"
            disabled={change.isPending}
            onPress={() => change.mutate({ add: true, id: item.id })}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>{t('expertAdd')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <FlatList
      contentContainerStyle={styles.list}
      contentInsetAdjustmentBehavior="automatic"
      data={data ?? []}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      keyExtractor={(expert) => expert.id}
      ListEmptyComponent={emptyState}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.intro}>{t('expertsIntro')}</Text>
          {error && data ? <Text style={styles.error}>{t('expertsRefreshError')}</Text> : null}
          {failed ? <Text style={styles.error}>{t('expertChangeError')}</Text> : null}
        </View>
      }
      refreshControl={
        <RefreshControl
          onRefresh={() => {
            refetch();
          }}
          refreshing={isFetching && !isLoading}
        />
      }
      renderItem={renderExpert}
      style={styles.screen}
    />
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    actions: { flexDirection: 'row', gap: 16, marginTop: 10 },
    avatar: {
      alignItems: 'center',
      borderRadius: 20,
      height: 40,
      justifyContent: 'center',
      width: 40,
    },
    avatarText: { fontSize: 20 },
    body: { flex: 1, gap: 2 },
    card: { backgroundColor: colors.card, borderRadius: 12, padding: 14 },
    centered: { alignItems: 'center', gap: 12, marginTop: 48 },
    danger: { color: colors.danger, fontSize: 15 },
    description: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
    error: { color: colors.danger, fontSize: 14 },
    header: { gap: 8, marginBottom: 12 },
    intro: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
    link: { color: colors.accent, fontSize: 16 },
    list: { flexGrow: 1, padding: 16 },
    message: { color: colors.secondaryLabel, fontSize: 16, textAlign: 'center' },
    pressed: { opacity: 0.6 },
    primary: { paddingVertical: 4 },
    primaryText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
    row: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
    screen: { backgroundColor: colors.background, flex: 1 },
    secondary: { paddingVertical: 4 },
    separator: { height: 12 },
    title: { color: colors.label, fontSize: 16, fontWeight: '600' },
  });
