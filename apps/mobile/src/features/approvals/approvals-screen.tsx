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

import { isMainlandEdition } from '@/config/app-config';
import { registerForPush, unregisterPush } from '@/features/push/register-for-push';
import { t } from '@/i18n/strings';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { type Palette, useColors } from '@/theme/colors';

import { ApprovalCard } from './approval-card';
import { usePendingApprovals, useRespondToApproval } from './use-approvals';

const signOut = async () => {
  // A failed unregister must not keep the user signed in; the server drops dead tokens later
  await unregisterPush(api).catch(() => undefined);
  await authClient.signOut();
};

export const ApprovalsScreen = () => {
  const colors = useColors();
  const styles = createStyles(colors);
  const { data, error, isFetching, isLoading, refetch } = usePendingApprovals(api);
  const respond = useRespondToApproval(api);

  useEffect(() => {
    // Without a push token the list still works; it just does not ring
    registerForPush(api).catch(() => undefined);
  }, []);

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
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable accessibilityRole="button" onPress={signOut}>
              <Text style={styles.link}>{t('signOut')}</Text>
            </Pressable>
          ),
          title: t('approvalsTitle'),
        }}
      />
      <FlatList
        contentContainerStyle={styles.list}
        data={data ?? []}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={emptyState}
        ListHeaderComponent={
          <>
            {isMainlandEdition ? <Text style={styles.edition}>{t('mainlandEdition')}</Text> : null}
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
    edition: { color: colors.secondaryLabel, fontSize: 13, marginBottom: 12 },
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
    screen: { backgroundColor: colors.background, flex: 1 },
    separator: { height: 12 },
  });
