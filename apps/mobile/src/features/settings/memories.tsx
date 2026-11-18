import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

import { type StringKey, t } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import type { Memory, MemoryPage } from './types';

export const memoriesKey = ['memories'] as const;

const LAYERS: Record<string, StringKey> = {
  activity: 'memoryLayerActivity',
  context: 'memoryLayerContext',
  experience: 'memoryLayerExperience',
  identity: 'memoryLayerIdentity',
  preference: 'memoryLayerPreference',
};

const formatDate = (date: Date) =>
  new Date(date).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** What Biber remembers about the person, newest first: forget one, or everything. */
export const MemoriesList = ({ api }: { api: ApiClient }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useInfiniteQuery({
    getNextPageParam: (last: MemoryPage, pages) => (last.hasMore ? pages.length + 1 : undefined),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.query('memories.list', { page: pageParam }) as Promise<MemoryPage>,
    queryKey: memoriesKey,
  });
  const memories = data?.pages.flatMap((page) => page.items) ?? [];

  const forget = useMutation({
    mutationFn: (input: { id: string } | 'all') =>
      input === 'all' ? api.mutation('memories.forgetAll') : api.mutation('memories.forget', input),
    onError: () => setFailed(true),
    onMutate: () => setFailed(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: memoriesKey }),
  });

  const confirm = (title: StringKey, body: StringKey, action: StringKey, onConfirm: () => void) =>
    Alert.alert(t(title), t(body), [
      { style: 'cancel', text: t('cancel') },
      { onPress: onConfirm, style: 'destructive', text: t(action) },
    ]);

  const emptyState = () => {
    if (data) return <Text style={styles.message}>{t('memoriesEmpty')}</Text>;
    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('memoriesError')}</Text>
          <Pressable accessibilityRole="button" onPress={() => refetch()}>
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return <ActivityIndicator style={styles.centered} />;
  };

  const renderMemory = ({ item }: { item: Memory }) => (
    <View style={styles.card}>
      <Text style={styles.meta}>
        {[
          item.layer && LAYERS[item.layer] ? t(LAYERS[item.layer]) : null,
          formatDate(item.capturedAt),
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {item.title ? <Text style={styles.title}>{item.title}</Text> : null}
      {item.summary ? <Text style={styles.summary}>{item.summary}</Text> : null}
      <Pressable
        accessibilityLabel={`${t('memoryForget')}: ${item.title ?? item.summary ?? ''}`}
        accessibilityRole="button"
        disabled={forget.isPending}
        onPress={() =>
          confirm('memoryForgetTitle', 'memoryForgetBody', 'memoryForget', () =>
            forget.mutate({ id: item.id }),
          )
        }
        style={styles.forget}
      >
        <Text style={styles.danger}>{t('memoryForget')}</Text>
      </Pressable>
    </View>
  );

  return (
    <FlatList
      contentContainerStyle={styles.list}
      contentInsetAdjustmentBehavior="automatic"
      data={memories}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      keyExtractor={(memory) => memory.id}
      ListEmptyComponent={emptyState}
      ListFooterComponent={
        <>
          {isFetchingNextPage ? <ActivityIndicator style={styles.footer} /> : null}
          {memories.length > 0 && !hasNextPage ? (
            <Pressable
              accessibilityRole="button"
              disabled={forget.isPending}
              onPress={() =>
                confirm(
                  'memoriesForgetAllTitle',
                  'memoriesForgetAllBody',
                  'memoriesForgetAll',
                  () => forget.mutate('all'),
                )
              }
              style={({ pressed }) => [styles.forgetAll, pressed && styles.pressed]}
            >
              <Text style={styles.danger}>{t('memoriesForgetAll')}</Text>
            </Pressable>
          ) : null}
        </>
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.intro}>{t('memoriesIntro')}</Text>
          {error && data ? <Text style={styles.error}>{t('memoriesRefreshError')}</Text> : null}
          {failed ? <Text style={styles.error}>{t('memoryForgetError')}</Text> : null}
        </View>
      }
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
      }}
      refreshControl={
        <RefreshControl
          onRefresh={() => {
            refetch();
          }}
          refreshing={isFetching && !isLoading && !isFetchingNextPage}
        />
      }
      renderItem={renderMemory}
      style={styles.screen}
      testID="memories-list"
    />
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: 12, gap: 4, padding: 14 },
    centered: { alignItems: 'center', gap: 12, marginTop: 48 },
    danger: { color: colors.danger, fontSize: 15 },
    error: { color: colors.danger, fontSize: 14 },
    footer: { marginVertical: 16 },
    forget: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 4 },
    forgetAll: {
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 12,
      marginTop: 24,
      padding: 14,
    },
    header: { gap: 8, marginBottom: 12 },
    intro: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
    link: { color: colors.accent, fontSize: 16 },
    list: { flexGrow: 1, padding: 16 },
    message: {
      color: colors.secondaryLabel,
      fontSize: 16,
      lineHeight: 22,
      marginTop: 48,
      textAlign: 'center',
    },
    meta: { color: colors.secondaryLabel, fontSize: 13 },
    pressed: { opacity: 0.6 },
    screen: { backgroundColor: colors.background, flex: 1 },
    separator: { height: 12 },
    summary: { color: colors.label, fontSize: 15, lineHeight: 21 },
    title: { color: colors.label, fontSize: 16, fontWeight: '600' },
  });
