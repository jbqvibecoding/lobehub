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

import { ActivityRow } from './activity-row';
import { useActivity } from './use-activity';

/** What agents did for the user, newest first; scrolling down loads older events. */
export const ActivityList = ({ api }: { api: ApiClient }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useActivity(api);
  const events = data?.pages.flatMap((page) => page.items) ?? [];

  const emptyState = () => {
    if (data) return <Text style={styles.message}>{t('activityEmpty')}</Text>;
    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('activityError')}</Text>
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
      data={events}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      keyExtractor={(event) => event.id}
      ListEmptyComponent={emptyState}
      ListFooterComponent={
        isFetchingNextPage ? <ActivityIndicator style={styles.footer} /> : undefined
      }
      ListHeaderComponent={
        error && data ? (
          <Text style={styles.inlineError}>{t('activityRefreshError')}</Text>
        ) : undefined
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
      renderItem={({ item }) => <ActivityRow event={item} />}
      style={styles.screen}
      testID="activity-list"
    />
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    centered: { alignItems: 'center', gap: 12, marginTop: 48 },
    footer: { marginVertical: 16 },
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
    screen: { backgroundColor: colors.background, flex: 1 },
    separator: { height: 12 },
  });
