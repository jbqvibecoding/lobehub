import { StyleSheet, Text, View } from 'react-native';

import { type Palette, useColors } from '@/theme/colors';

import { type ActivityTone, describeActivity } from './describe-activity';
import type { ActivityEvent } from './types';

const toneColor = (colors: Palette, tone: ActivityTone) =>
  ({
    done: colors.success,
    problem: colors.danger,
    stopped: colors.warning,
    waiting: colors.accent,
  })[tone];

const formatTime = (date: Date) =>
  date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const ActivityRow = ({ event }: { event: ActivityEvent }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const summary = describeActivity(event);
  const meta = [formatTime(new Date(event.createdAt)), summary.where].filter(Boolean).join(' · ');

  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <Text style={[styles.status, { color: toneColor(colors, summary.tone) }]}>
          {summary.status}
        </Text>
        <Text style={styles.meta}>{meta}</Text>
      </View>
      <Text style={styles.title}>{summary.title}</Text>
      {summary.details.map((detail) => (
        <Text key={detail} numberOfLines={1} style={styles.detail}>
          {detail}
        </Text>
      ))}
      {summary.note ? <Text style={styles.note}>{summary.note}</Text> : null}
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    detail: { color: colors.secondaryLabel, fontSize: 14, marginTop: 2 },
    header: { alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between' },
    meta: { color: colors.secondaryLabel, flexShrink: 1, fontSize: 13, marginLeft: 12 },
    note: { color: colors.label, fontSize: 14, marginTop: 6 },
    row: { backgroundColor: colors.card, borderRadius: 12, padding: 14 },
    status: { fontSize: 13, fontWeight: '600' },
    title: { color: colors.label, fontSize: 16, fontWeight: '600', marginTop: 4 },
  });
