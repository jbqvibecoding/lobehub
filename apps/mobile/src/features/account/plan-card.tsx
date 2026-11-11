import { StyleSheet, Text, View } from 'react-native';

import { t } from '@/i18n/strings';
import { type Palette, useColors } from '@/theme/colors';

import { describeBilling, describeCredits, describeRenewal, planName } from './describe-plan';
import type { PlanStatus } from './types';

/** The current plan, what happens to it next, and how much of this month's credits are used. */
export const PlanCard = ({ status }: { status: PlanStatus }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const renewal = describeRenewal(status);
  const billing = describeBilling(status.subscription?.provider);
  const credits = describeCredits(status);
  const toneColor = {
    normal: colors.secondaryLabel,
    problem: colors.danger,
    warning: colors.warning,
  };

  return (
    <View style={styles.card} testID="plan-card">
      <Text style={styles.caption}>{t('planTitle')}</Text>
      <Text accessibilityRole="header" style={styles.planName}>
        {planName(status.plan)}
      </Text>
      {renewal ? (
        <Text style={[styles.detail, { color: toneColor[renewal.tone] }]}>{renewal.text}</Text>
      ) : null}
      {billing ? <Text style={styles.detail}>{billing}</Text> : null}

      <View style={styles.divider} />

      <Text style={styles.creditsText}>{credits.usedText}</Text>
      <View
        accessibilityLabel={credits.usedText}
        accessible
        accessibilityValue={{ max: 100, min: 0, now: Math.round(credits.usedFraction * 100) }}
        role="progressbar"
        style={styles.track}
      >
        <View
          style={[
            styles.fill,
            {
              backgroundColor: credits.usedFraction >= 0.9 ? colors.warning : colors.accent,
              width: `${credits.usedFraction * 100}%`,
            },
          ]}
        />
      </View>
      <Text style={styles.detail}>{credits.reset}</Text>
      <Text style={styles.note}>{t('ownKeyNote')}</Text>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    caption: { color: colors.secondaryLabel, fontSize: 13, textTransform: 'uppercase' },
    card: { backgroundColor: colors.card, borderRadius: 12, gap: 6, padding: 16 },
    creditsText: { color: colors.label, fontSize: 15 },
    detail: { color: colors.secondaryLabel, fontSize: 14 },
    divider: {
      backgroundColor: colors.border,
      height: StyleSheet.hairlineWidth,
      marginVertical: 8,
    },
    fill: { borderRadius: 3, height: 6 },
    note: { color: colors.secondaryLabel, fontSize: 12, marginTop: 4 },
    planName: { color: colors.label, fontSize: 28, fontWeight: '700' },
    track: { backgroundColor: colors.border, borderRadius: 3, height: 6, overflow: 'hidden' },
  });
