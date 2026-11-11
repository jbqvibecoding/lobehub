import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { type StringKey, t, tf } from '@/i18n/strings';
import { type Palette, useColors } from '@/theme/colors';

import { formatCredits, planName } from './describe-plan';
import { type AppleProduct, upgradeOffers } from './store/upgrade-offers';

/** Apple's standard licence agreement, which App Store subscriptions fall under. */
const APPLE_STANDARD_EULA = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

interface PlanOffersProps {
  billedByApple: boolean;
  buying?: string;
  currentPlan: string;
  notice?: StringKey;
  onBuy: (productId: string) => void;
  onManage: () => void;
  onRestore: () => void;
  prices?: Map<string, string>;
  products: AppleProduct[];
}

/** The plans above the current one, sold through the App Store, with restore and manage. */
export const PlanOffers = ({
  billedByApple,
  buying,
  currentPlan,
  notice,
  onBuy,
  onManage,
  onRestore,
  prices,
  products,
}: PlanOffersProps) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const [interval, setBillingInterval] = useState<AppleProduct['interval']>('monthly');
  const offers = prices ? upgradeOffers(currentPlan, products, prices, interval) : [];

  return (
    <View style={styles.card} testID="plan-offers">
      <Text accessibilityRole="header" style={styles.title}>
        {t('upgradeTitle')}
      </Text>

      <View accessibilityRole="tablist" style={styles.segments}>
        {(['monthly', 'yearly'] as const).map((value) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: interval === value }}
            key={value}
            onPress={() => setBillingInterval(value)}
            style={[styles.segment, interval === value && styles.segmentSelected]}
          >
            <Text style={interval === value ? styles.segmentTextSelected : styles.segmentText}>
              {t(value === 'monthly' ? 'billingMonthly' : 'billingYearly')}
            </Text>
          </Pressable>
        ))}
      </View>

      {prices ? null : <ActivityIndicator />}
      {offers.map((offer) => (
        <View key={offer.productId} style={styles.offer}>
          <View style={styles.offerText}>
            <Text style={styles.offerName}>{planName(offer.plan)}</Text>
            <Text style={styles.detail}>
              {tf('offerCredits', { credits: formatCredits(offer.monthlyCredits) })}
            </Text>
            <Text style={styles.price}>
              {tf(offer.interval === 'monthly' ? 'perMonth' : 'perYear', { price: offer.price })}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={`${t('subscribe')} ${planName(offer.plan)}`}
            accessibilityRole="button"
            accessibilityState={{ busy: buying === offer.productId, disabled: !!buying }}
            disabled={!!buying}
            onPress={() => onBuy(offer.productId)}
            style={[styles.button, !!buying && styles.buttonDisabled]}
          >
            {buying === offer.productId ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>{t('subscribe')}</Text>
            )}
          </Pressable>
        </View>
      ))}

      {notice ? (
        <Text accessibilityLiveRegion="polite" role="alert" style={styles.notice}>
          {t(notice)}
        </Text>
      ) : null}

      <View style={styles.links}>
        <Pressable accessibilityRole="button" onPress={onRestore}>
          <Text style={styles.link}>{t('restorePurchases')}</Text>
        </Pressable>
        {billedByApple ? (
          <Pressable accessibilityRole="button" onPress={onManage}>
            <Text style={styles.link}>{t('manageSubscription')}</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.terms}>{t('subscriptionTerms')}</Text>
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL(APPLE_STANDARD_EULA)}>
        <Text style={styles.termsLink}>{t('termsOfUse')}</Text>
      </Pressable>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    button: {
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: 10,
      minWidth: 96,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
    card: { backgroundColor: colors.card, borderRadius: 12, gap: 12, padding: 16 },
    detail: { color: colors.secondaryLabel, fontSize: 13 },
    link: { color: colors.accent, fontSize: 15 },
    links: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
    notice: { color: colors.label, fontSize: 14 },
    offer: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    offerName: { color: colors.label, fontSize: 17, fontWeight: '600' },
    offerText: { flex: 1, gap: 2 },
    price: { color: colors.label, fontSize: 14 },
    segment: { alignItems: 'center', borderRadius: 8, flex: 1, paddingVertical: 6 },
    segmentSelected: { backgroundColor: colors.card },
    segmentText: { color: colors.secondaryLabel, fontSize: 14 },
    segmentTextSelected: { color: colors.label, fontSize: 14, fontWeight: '600' },
    segments: {
      backgroundColor: colors.background,
      borderRadius: 10,
      flexDirection: 'row',
      padding: 2,
    },
    terms: { color: colors.secondaryLabel, fontSize: 11 },
    termsLink: { color: colors.accent, fontSize: 12 },
    title: { color: colors.label, fontSize: 20, fontWeight: '700' },
  });
