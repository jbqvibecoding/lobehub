import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { openBrowserAsync } from 'expo-web-browser';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { t, tf } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

export const githubKey = ['github', 'status'] as const;

/** `github.status` on the server. */
export type GithubStatus =
  | { available: boolean; connected: false }
  | { available: true; connected: true; login: string; repositories?: string[] };

/**
 * "GitHub": the repositories the coding expert may work on. The user installs the Biber GitHub App
 * on the ones they choose, in the browser; every push still waits for their approval here.
 */
export const GithubView = ({ api }: { api: ApiClient }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();

  const status = useQuery({
    queryFn: () => api.query('github.status') as Promise<GithubStatus>,
    queryKey: githubKey,
  });
  const connect = useMutation({
    mutationFn: async () => {
      const { url } = (await api.mutation('github.connectUrl')) as { url: string };
      // Back from the browser, the connection shows once the list reloads
      await openBrowserAsync(url);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: githubKey }),
  });
  const disconnect = useMutation({
    mutationFn: () => api.mutation('github.disconnect'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: githubKey }),
  });

  if (!status.data) {
    if (status.error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('githubError')}</Text>
          <Pressable onPress={() => status.refetch()} role="button">
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return <ActivityIndicator style={styles.centered} />;
  }

  const data = status.data;
  if (!data.connected && !data.available) {
    return <Text style={styles.message}>{t('githubUnavailable')}</Text>;
  }

  const confirmDisconnect = (login: string) =>
    Alert.alert(tf('githubDisconnectTitle', { login }), t('githubDisconnectBody'), [
      { style: 'cancel', text: t('cancel') },
      { onPress: () => disconnect.mutate(), style: 'destructive', text: t('githubDisconnect') },
    ]);

  return (
    <View style={styles.list}>
      <Text style={styles.intro}>{t('githubIntro')}</Text>
      {connect.isError ? <Text style={styles.error}>{t('githubConnectError')}</Text> : null}
      {disconnect.isError ? <Text style={styles.error}>{t('githubDisconnectError')}</Text> : null}

      {data.connected ? (
        <View style={styles.card}>
          <Text role="heading" style={styles.name}>
            {data.login}
          </Text>
          {data.repositories ? (
            data.repositories.length > 0 ? (
              data.repositories.map((repository) => (
                <Text key={repository} style={styles.detail}>
                  {repository}
                </Text>
              ))
            ) : (
              <Text style={styles.detail}>{t('githubNoRepositories')}</Text>
            )
          ) : (
            <Text style={styles.detail}>{t('githubRepositoriesError')}</Text>
          )}
          <View style={styles.actions}>
            <Pressable
              aria-busy={connect.isPending}
              disabled={connect.isPending}
              onPress={() => connect.mutate()}
              role="button"
              style={styles.secondary}
            >
              <Text style={styles.secondaryLabel}>{t('githubChooseRepositories')}</Text>
            </Pressable>
            <Pressable
              aria-busy={disconnect.isPending}
              disabled={disconnect.isPending}
              onPress={() => confirmDisconnect(data.login)}
              role="button"
              style={styles.secondary}
            >
              <Text style={styles.dangerLabel}>{t('githubDisconnect')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          aria-busy={connect.isPending}
          disabled={connect.isPending}
          onPress={() => connect.mutate()}
          role="button"
          style={styles.primary}
        >
          {connect.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryLabel}>{t('githubConnect')}</Text>
          )}
        </Pressable>
      )}
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 },
    card: { backgroundColor: colors.card, borderRadius: 16, padding: 16 },
    centered: { alignItems: 'center', gap: 12, marginTop: 48 },
    dangerLabel: { color: colors.danger, fontSize: 15, fontWeight: '600' },
    detail: { color: colors.secondaryLabel, fontSize: 14, marginTop: 4 },
    error: { color: colors.danger, fontSize: 14 },
    intro: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
    link: { color: colors.accent, fontSize: 16 },
    list: { gap: 16 },
    message: { color: colors.secondaryLabel, fontSize: 15, textAlign: 'center' },
    name: { color: colors.label, fontSize: 17, fontWeight: '600', marginBottom: 4 },
    primary: {
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: 12,
      justifyContent: 'center',
      minHeight: 48,
    },
    primaryLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
    secondary: {
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center',
      minHeight: 44,
      paddingHorizontal: 14,
    },
    secondaryLabel: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  });
