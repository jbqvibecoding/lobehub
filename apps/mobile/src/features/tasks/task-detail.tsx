import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { t } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import { canRunNow, describeActivity, taskTitle } from './describe-task';
import { TaskStatusLabel } from './task-status';
import type { TaskActivity } from './types';
import { useRunTask, useTaskDetail } from './use-tasks';

const formatTime = (date: Date) =>
  date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const newestFirst = (activities: TaskActivity[]) =>
  activities
    .map((activity) => ({ activity, summary: describeActivity(activity) }))
    .sort((a, b) => (b.summary.when?.getTime() ?? 0) - (a.summary.when?.getTime() ?? 0));

/** One task: where it stands, what it was asked to do, and what happened so far. */
export const TaskDetailView = ({ api, id }: { api: ApiClient; id: string }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const { data: task, error, isFetching, isLoading, refetch } = useTaskDetail(api, id);
  const run = useRunTask(api, id);

  if (!task) {
    return (
      <View style={[styles.screen, styles.centered]}>
        {error ? (
          <>
            <Text style={styles.message}>{t('taskDetailError')}</Text>
            <Pressable onPress={() => refetch()} role="button">
              <Text style={styles.link}>{t('retry')}</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  const history = newestFirst(task.activities ?? []);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          onRefresh={() => {
            refetch();
          }}
          refreshing={isFetching && !isLoading}
        />
      }
      style={styles.screen}
    >
      <View style={styles.header}>
        <Text style={styles.identifier}>{task.identifier}</Text>
        <TaskStatusLabel status={task.status} />
      </View>
      <Text role="heading" style={styles.title}>
        {taskTitle(task)}
      </Text>
      {task.error ? <Text style={styles.error}>{task.error}</Text> : null}

      {canRunNow(task.status) ? (
        <Pressable
          aria-busy={run.isPending}
          aria-label={t('taskRun')}
          disabled={run.isPending}
          onPress={() => run.mutate()}
          role="button"
          style={styles.runButton}
        >
          {run.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.runLabel}>{t('taskRun')}</Text>
          )}
        </Pressable>
      ) : null}
      {run.isError ? <Text style={styles.error}>{t('taskRunError')}</Text> : null}

      <Text style={styles.instruction}>{task.instruction}</Text>

      {task.subtasks?.length ? (
        <View style={styles.section}>
          <Text role="heading" style={styles.sectionTitle}>
            {t('taskSubtasks')}
          </Text>
          {task.subtasks.map((subtask) => (
            <View key={subtask.identifier} style={styles.line}>
              <Text numberOfLines={1} style={styles.lineText}>
                {`${subtask.identifier} ${subtask.name ?? ''}`.trim()}
              </Text>
              <TaskStatusLabel status={subtask.status} />
            </View>
          ))}
        </View>
      ) : null}

      {history.length ? (
        <View style={styles.section}>
          <Text role="heading" style={styles.sectionTitle}>
            {t('taskHistory')}
          </Text>
          {history.map(({ activity, summary }, index) => (
            <View key={activity.id ?? `${activity.type}-${index}`} style={styles.entry}>
              <View style={styles.line}>
                <Text style={styles.entryLabel}>{summary.label}</Text>
                {summary.status ? <TaskStatusLabel status={activity.status!} /> : null}
              </View>
              {summary.text ? (
                <Text numberOfLines={4} style={styles.entryText}>
                  {summary.text}
                </Text>
              ) : null}
              {summary.when ? <Text style={styles.meta}>{formatTime(summary.when)}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    centered: { alignItems: 'center', gap: 12, justifyContent: 'center' },
    content: { gap: 12, padding: 16 },
    entry: { backgroundColor: colors.card, borderRadius: 12, gap: 4, padding: 12 },
    entryLabel: { color: colors.label, fontSize: 14, fontWeight: '600' },
    entryText: { color: colors.label, fontSize: 14, lineHeight: 20 },
    error: { color: colors.warning, fontSize: 14 },
    header: { flexDirection: 'row', justifyContent: 'space-between' },
    identifier: { color: colors.secondaryLabel, fontSize: 13 },
    instruction: { color: colors.label, fontSize: 15, lineHeight: 22 },
    line: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
    lineText: { color: colors.label, flexShrink: 1, fontSize: 15 },
    link: { color: colors.accent, fontSize: 16 },
    message: { color: colors.secondaryLabel, fontSize: 16, textAlign: 'center' },
    meta: { color: colors.secondaryLabel, fontSize: 12 },
    runButton: {
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: 12,
      justifyContent: 'center',
      minHeight: 48,
    },
    runLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
    screen: { backgroundColor: colors.background, flex: 1 },
    section: { gap: 8, marginTop: 8 },
    sectionTitle: {
      color: colors.secondaryLabel,
      fontSize: 13,
      fontWeight: '600',
      textTransform: 'uppercase',
    },
    title: { color: colors.label, fontSize: 22, fontWeight: '700' },
  });
