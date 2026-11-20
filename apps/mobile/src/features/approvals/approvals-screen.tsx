import { getCalendars } from 'expo-localization';
import { Stack } from 'expo-router/stack';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { syncNotificationTray } from '@/features/push/notification-answer';
import { registerForPush } from '@/features/push/register-for-push';
import { t } from '@/i18n/strings';
import { api } from '@/lib/api';
import { type Palette, useColors } from '@/theme/colors';

import { ApprovalCard } from './approval-card';
import { useApprovalNotice } from './approval-notice';
import { usePendingApprovals, useRespondToApproval } from './use-approvals';

export const ApprovalsScreen = () => {
  const colors = useColors();
  const styles = createStyles(colors);
  const { data, error, isFetching, isLoading, refetch } = usePendingApprovals(api);
  const respond = useRespondToApproval(api);
  const notice = useApprovalNotice();

  useEffect(() => {
    // Without a push token the list still works; it just does not ring
    registerForPush(api).catch(() => undefined);
    // Quiet hours and reminder times follow the phone's time zone
    const timeZone = getCalendars()[0]?.timeZone;
    if (timeZone) api.mutation('proactive.updateSettings', { timeZone }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (data) syncNotificationTray(data).catch(() => undefined);
  }, [data]);

  const emptyState = () => {
    if (data) return <Text style={styles.message}>{t('approvalsEmpty')}</Text>;
    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('approvalsError')}</Text>
          <Pressable accessibilityRole="button" onPress={() => refetch()}>
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return <ActivityIndicator style={styles.centered} />;
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: t('approvalsTitle') }} />
      <FlatList
        contentContainerStyle={styles.list}
        data={data ?? []}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={emptyState}
        ListHeaderComponent={
          <>
            {notice ? (
              <Text accessibilityLiveRegion="polite" role="status" style={styles.notice}>
                {notice}
              </Text>
            ) : null}
            {error && data ? (
              <Text style={styles.inlineError}>{t('approvalsRefreshError')}</Text>
            ) : null}
          </>
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
          <ApprovalCard
            approval={item}
            onRespond={(decision) => respond.mutateAsync({ decision, toolMessageId: item.id })}
          />
        )}
      />
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    centered: { alignItems: 'center', gap: 12, marginTop: 48 },
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
    notice: { color: colors.label, fontSize: 15, fontWeight: '600', marginBottom: 12 },
    screen: { backgroundColor: colors.background, flex: 1 },
    separator: { height: 12 },
  });
