import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { type StringKey, t, tf } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import type { ProactiveLevel, ProactiveSettings, ProactiveThought } from './types';

export const proactiveSettingsKey = ['proactive', 'settings'] as const;
export const proactiveThoughtsKey = ['proactive', 'thoughts'] as const;

const LEVELS: { label: StringKey; level: ProactiveLevel }[] = [
  { label: 'proactiveLevelStandard', level: 'standard' },
  { label: 'proactiveLevelQuiet', level: 'quiet' },
  { label: 'proactiveLevelOff', level: 'off' },
];

const PAUSE_DAYS = 7;

const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
const shiftHour = (hour: number, by: number) => (hour + by + 24) % 24;

const formatWhen = (date: Date) =>
  new Date(date).toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    weekday: 'short',
  });

type SettingsChange = Partial<Pick<ProactiveSettings, 'level' | 'quietEnd' | 'quietStart'>> & {
  quietForDays?: number | null;
};

/**
 * How Biber speaks up unprompted: how often, when it stays quiet, a pause, and the things it
 * means to bring up, each of which the user can take off the list.
 */
export const ProactiveSettingsView = ({ api }: { api: ApiClient }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryFn: () => api.query('proactive.getSettings') as Promise<ProactiveSettings>,
    queryKey: proactiveSettingsKey,
  });
  const thoughts = useQuery({
    queryFn: () => api.query('proactive.listThoughts') as Promise<ProactiveThought[]>,
    queryKey: proactiveThoughtsKey,
  });

  const update = useMutation({
    mutationFn: (change: SettingsChange) =>
      api.mutation('proactive.updateSettings', change) as Promise<ProactiveSettings>,
    onSuccess: (saved) => queryClient.setQueryData(proactiveSettingsKey, saved),
  });
  const drop = useMutation({
    mutationFn: (id: string) => api.mutation('proactive.dropThought', { id }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: proactiveThoughtsKey }),
  });

  const refresh = () => {
    settings.refetch();
    thoughts.refetch();
  };

  if (!settings.data) {
    return settings.error ? (
      <View style={styles.centered}>
        <Text style={styles.message}>{t('proactiveError')}</Text>
        <Pressable accessibilityRole="button" onPress={() => settings.refetch()}>
          <Text style={styles.link}>{t('retry')}</Text>
        </Pressable>
      </View>
    ) : (
      <ActivityIndicator style={styles.centered} />
    );
  }

  const current = settings.data;
  const paused = !!current.cooldownUntil && new Date(current.cooldownUntil) > new Date();
  const saving = update.isPending;

  const hourStepper = (label: StringKey, key: 'quietEnd' | 'quietStart') => (
    <View style={styles.stepper}>
      <Text style={styles.rowTitle}>{t(label)}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          accessibilityLabel={`${t(label)}: ${t('proactiveEarlier')}`}
          accessibilityRole="button"
          disabled={saving}
          onPress={() => update.mutate({ [key]: shiftHour(current[key], -1) })}
          style={styles.stepButton}
        >
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Text style={styles.hour}>{formatHour(current[key])}</Text>
        <Pressable
          accessibilityLabel={`${t(label)}: ${t('proactiveLater')}`}
          accessibilityRole="button"
          disabled={saving}
          onPress={() => update.mutate({ [key]: shiftHour(current[key], 1) })}
          style={styles.stepButton}
        >
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          onRefresh={refresh}
          refreshing={(settings.isRefetching || thoughts.isRefetching) && !saving}
        />
      }
      style={styles.screen}
    >
      {update.isError ? <Text style={styles.inlineError}>{t('proactiveSaveError')}</Text> : null}

      <Text style={styles.section}>{t('proactiveLevelTitle')}</Text>
      <View style={styles.card}>
        {LEVELS.map(({ label, level }) => (
          <Pressable
            accessibilityLabel={t(label)}
            accessibilityRole="radio"
            accessibilityState={{ checked: current.level === level, disabled: saving }}
            disabled={saving}
            key={level}
            onPress={() => update.mutate({ level })}
            style={styles.option}
          >
            <Text style={styles.rowTitle}>{t(label)}</Text>
            {current.level === level ? (
              <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.check}>
                ✓
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>{t('proactiveQuietHours')}</Text>
      <View style={styles.card}>
        {hourStepper('proactiveQuietStart', 'quietStart')}
        {hourStepper('proactiveQuietEnd', 'quietEnd')}
      </View>
      <Text style={styles.hint}>{t('proactiveQuietHint')}</Text>

      <View style={styles.card}>
        {paused ? (
          <View style={styles.option}>
            <Text style={styles.rowTitle}>
              {tf('proactivePausedUntil', { date: formatWhen(current.cooldownUntil!) })}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => update.mutate({ quietForDays: null })}
            >
              <Text style={styles.link}>{t('proactiveResume')}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={saving || current.level === 'off'}
            onPress={() => update.mutate({ quietForDays: PAUSE_DAYS })}
            style={styles.option}
          >
            <Text style={[styles.link, current.level === 'off' && styles.disabled]}>
              {t('proactivePause')}
            </Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.section}>{t('proactiveThoughtsTitle')}</Text>
      {thoughts.data && thoughts.data.length === 0 ? (
        <Text style={styles.hint}>{t('proactiveThoughtsEmpty')}</Text>
      ) : null}
      {thoughts.error && !thoughts.data ? (
        <Pressable accessibilityRole="button" onPress={() => thoughts.refetch()}>
          <Text style={styles.link}>{t('retry')}</Text>
        </Pressable>
      ) : null}
      {!thoughts.data && !thoughts.error ? <ActivityIndicator /> : null}
      {thoughts.data?.map((thought) => (
        <View key={thought.id} style={styles.thought}>
          <Text style={styles.meta}>
            {[
              t(
                thought.source === 'asked'
                  ? 'proactiveThoughtAsked'
                  : thought.kind === 'reminder'
                    ? 'proactiveThoughtReminder'
                    : 'proactiveThoughtFollowUp',
              ),
              (thought.dueAt ?? thought.occursAt)
                ? formatWhen((thought.dueAt ?? thought.occursAt)!)
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Text style={styles.rowTitle}>{thought.seed}</Text>
          <Pressable
            accessibilityLabel={`${t('proactiveThoughtRemove')}: ${thought.seed}`}
            accessibilityRole="button"
            disabled={drop.isPending}
            onPress={() => drop.mutate(thought.id)}
          >
            <Text style={styles.danger}>{t('proactiveThoughtRemove')}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      marginBottom: 8,
      paddingHorizontal: 16,
    },
    centered: { alignItems: 'center', gap: 12, padding: 32 },
    check: { color: colors.accent, fontSize: 17, fontWeight: '600' },
    content: { padding: 16, paddingBottom: 48 },
    danger: { color: colors.danger, fontSize: 15, marginTop: 8 },
    disabled: { color: colors.secondaryLabel },
    hint: { color: colors.secondaryLabel, fontSize: 13, marginBottom: 16 },
    hour: {
      color: colors.label,
      fontSize: 17,
      fontVariant: ['tabular-nums'],
      minWidth: 56,
      textAlign: 'center',
    },
    inlineError: { color: colors.danger, fontSize: 14, marginBottom: 12 },
    link: { color: colors.accent, fontSize: 16 },
    message: { color: colors.secondaryLabel, fontSize: 15, textAlign: 'center' },
    meta: { color: colors.secondaryLabel, fontSize: 13, marginBottom: 4 },
    option: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 48,
    },
    rowTitle: { color: colors.label, flexShrink: 1, fontSize: 16 },
    screen: { backgroundColor: colors.background },
    section: {
      color: colors.secondaryLabel,
      fontSize: 13,
      marginBottom: 8,
      marginTop: 16,
      textTransform: 'uppercase',
    },
    stepButton: {
      alignItems: 'center',
      borderRadius: 8,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    stepText: { color: colors.accent, fontSize: 22 },
    stepper: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 48,
    },
    stepperControls: { alignItems: 'center', flexDirection: 'row' },
    thought: {
      backgroundColor: colors.card,
      borderRadius: 12,
      marginBottom: 8,
      padding: 16,
    },
  });
