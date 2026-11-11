import { Stack } from 'expo-router/stack';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { isMainlandEdition } from '@/config/app-config';
import { t } from '@/i18n/strings';
import { api } from '@/lib/api';
import { type Palette, useColors } from '@/theme/colors';

import { PlanCard } from './plan-card';
import { PlanOffers } from './plan-offers';
import { signOut } from './sign-out';
import { useAppStore } from './store/use-app-store';
import { usePlan } from './use-plan';

export const AccountScreen = () => {
  const colors = useColors();
  const styles = createStyles(colors);
  const { data, error, isFetching, isLoading, refetch } = usePlan(api);
  const store = useAppStore(api, data);
  const billedOnWeb = !!data?.subscription && data.subscription.provider !== 'apple';

  const plan = () => {
    if (data) return <PlanCard status={data} />;
    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('planError')}</Text>
          <Pressable accessibilityRole="button" onPress={() => refetch()}>
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return <ActivityIndicator style={styles.centered} />;
  };

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
      <Stack.Screen options={{ title: t('accountTitle') }} />
      {error && data ? <Text style={styles.inlineError}>{t('planRefreshError')}</Text> : null}
      {plan()}
      {store.enabled && data ? (
        <PlanOffers
          billedByApple={data.subscription?.provider === 'apple'}
          buying={store.buying}
          currentPlan={data.plan}
          notice={store.notice}
          onBuy={store.buy}
          onManage={store.manage}
          onRestore={store.restore}
          prices={store.prices}
          products={store.products}
        />
      ) : null}
      {billedOnWeb ? <Text style={styles.message}>{t('billedOnWebNote')}</Text> : null}
      {isMainlandEdition ? <Text style={styles.edition}>{t('mainlandEdition')}</Text> : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => signOut(api)}
        style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
      >
        <Text style={styles.signOutText}>{t('signOut')}</Text>
      </Pressable>
    </ScrollView>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    centered: { alignItems: 'center', gap: 12, paddingVertical: 48 },
    content: { gap: 16, padding: 16 },
    edition: { color: colors.secondaryLabel, fontSize: 13, textAlign: 'center' },
    inlineError: { color: colors.warning, fontSize: 13 },
    link: { color: colors.accent, fontSize: 16 },
    message: { color: colors.secondaryLabel, fontSize: 15, textAlign: 'center' },
    pressed: { opacity: 0.6 },
    screen: { backgroundColor: colors.background },
    signOut: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 14 },
    signOutText: { color: colors.danger, fontSize: 16 },
  });
