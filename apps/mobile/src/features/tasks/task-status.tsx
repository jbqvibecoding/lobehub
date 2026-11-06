import { StyleSheet, Text } from 'react-native';

import { type Palette, useColors } from '@/theme/colors';

import { describeStatus, type TaskTone } from './describe-task';

const toneColor = (colors: Palette, tone: TaskTone) =>
  ({
    done: colors.success,
    idle: colors.secondaryLabel,
    problem: colors.warning,
    working: colors.accent,
  })[tone];

export const TaskStatusLabel = ({ status }: { status: string }) => {
  const colors = useColors();
  const { label, tone } = describeStatus(status);

  return <Text style={[styles.status, { color: toneColor(colors, tone) }]}>{label}</Text>;
};

const styles = StyleSheet.create({ status: { fontSize: 13, fontWeight: '600' } });
