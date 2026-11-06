import { Link } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { t } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import { groupTitle, taskTitle } from './describe-task';
import { TaskStatusLabel } from './task-status';
import { useTaskBoard } from './use-tasks';

/** The user's tasks, grouped like the web board, what needs them first. */
export const TaskBoard = ({ api }: { api: ApiClient }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const { data, error, isFetching, isLoading, refetch } = useTaskBoard(api);

  const sections = (data ?? [])
    .filter((group) => group.tasks.length > 0)
    .map((group) => ({ data: group.tasks, key: group.key, total: group.total }));

  const emptyState = () => {
    if (data) return <Text style={styles.message}>{t('tasksEmpty')}</Text>;
    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('tasksError')}</Text>
          <Pressable onPress={() => refetch()} role="button">
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return <ActivityIndicator style={styles.centered} />;
  };

  return (
    <SectionList
      contentContainerStyle={styles.list}
      contentInsetAdjustmentBehavior="automatic"
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      keyExtractor={(task) => task.id}
      ListEmptyComponent={emptyState}
      ListHeaderComponent={
        error && data ? <Text style={styles.inlineError}>{t('tasksRefreshError')}</Text> : undefined
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
        <Link asChild href={{ params: { id: item.id }, pathname: '/tasks/[id]' }}>
          <Pressable role="button" style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.identifier}>{item.identifier}</Text>
              <TaskStatusLabel status={item.status} />
            </View>
            <Text numberOfLines={2} style={styles.title}>
              {taskTitle(item)}
            </Text>
            {item.error ? (
              <Text numberOfLines={2} style={styles.error}>
                {item.error}
              </Text>
            ) : null}
          </Pressable>
        </Link>
      )}
      renderSectionHeader={({ section }) => (
        <Text role="heading" style={styles.sectionHeader}>
          {`${groupTitle(section.key)} · ${section.total}`}
        </Text>
      )}
      sections={sections}
      stickySectionHeadersEnabled={false}
      style={styles.screen}
    />
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    centered: { alignItems: 'center', gap: 12, marginTop: 48 },
    error: { color: colors.warning, fontSize: 14, marginTop: 4 },
    identifier: { color: colors.secondaryLabel, fontSize: 13 },
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
    row: { backgroundColor: colors.card, borderRadius: 12, padding: 14 },
    rowHeader: { flexDirection: 'row', justifyContent: 'space-between' },
    screen: { backgroundColor: colors.background, flex: 1 },
    sectionHeader: {
      color: colors.secondaryLabel,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 8,
      marginTop: 16,
      textTransform: 'uppercase',
    },
    separator: { height: 8 },
    title: { color: colors.label, fontSize: 16, fontWeight: '600', marginTop: 4 },
  });
