import { Link } from 'expo-router';
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
import { type StringKey, t } from '@/i18n/strings';
import { api } from '@/lib/api';
import { type Palette, useColors } from '@/theme/colors';

import { PlanCard } from './plan-card';
import { PlanOffers } from './plan-offers';
import { signOut } from './sign-out';
import { useAppStore } from './store/use-app-store';
import { usePlan } from './use-plan';

const SETTINGS: {
  hint: StringKey;
  href:
    | '/accounts'
    | '/chat-apps'
    | '/computer'
    | '/experts'
    | '/github'
    | '/logins'
    | '/memories'
    | '/proactive'
    | '/profile';
  title: StringKey;
}[] = [
  { hint: 'profileEntryHint', href: '/profile', title: 'profileTitle' },
  { hint: 'expertsEntryHint', href: '/experts', title: 'expertsTitle' },
  { hint: 'accountsEntryHint', href: '/accounts', title: 'accountsTitle' },
  { hint: 'linkedChatsEntryHint', href: '/chat-apps', title: 'linkedChatsTitle' },
  { hint: 'memoriesEntryHint', href: '/memories', title: 'memoriesTitle' },
  { hint: 'proactiveEntryHint', href: '/proactive', title: 'proactiveTitle' },
  { hint: 'computerEntryHint', href: '/computer', title: 'computerTitle' },
  { hint: 'loginsEntryHint', href: '/logins', title: 'loginsTitle' },
  { hint: 'githubEntryHint', href: '/github', title: 'githubTitle' },
];

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
      {SETTINGS.map(({ hint, href, title }) => (
        <Link asChild href={href} key={href}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text style={styles.rowTitle}>{t(title)}</Text>
            <Text style={styles.rowHint}>{t(hint)}</Text>
          </Pressable>
        </Link>
      ))}
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
    row: { backgroundColor: colors.card, borderRadius: 12, gap: 2, padding: 14 },
    rowHint: { color: colors.secondaryLabel, fontSize: 13 },
    rowTitle: { color: colors.label, fontSize: 16 },
    screen: { backgroundColor: colors.background },
    signOut: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 14 },
    signOutText: { color: colors.danger, fontSize: 16 },
  });
