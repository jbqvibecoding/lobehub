import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { t, tf } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import { chatAppName, howToLink } from './describe-chat-app';
import type { ChatLink, ChatPlatform } from './types';

export const chatLinksKey = ['messenger', 'links'] as const;
const platformsKey = ['messenger', 'platforms'] as const;

/**
 * The chat apps this service offers, and which of them reach the person's Biber: linked ones can
 * be unlinked; for the others, how to start linking from the phone.
 */
export const LinkedChatsView = ({ api }: { api: ApiClient }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);

  const platforms = useQuery({
    queryFn: () => api.query('messenger.availablePlatforms') as Promise<ChatPlatform[]>,
    queryKey: platformsKey,
  });
  const links = useQuery({
    queryFn: () => api.query('messenger.listMyLinks') as Promise<ChatLink[]>,
    queryKey: chatLinksKey,
  });

  const unlink = useMutation({
    mutationFn: (link: ChatLink) =>
      api.mutation('messenger.unlink', {
        platform: link.platform,
        ...(link.tenantId && { tenantId: link.tenantId }),
      }),
    onError: () => setFailed(true),
    onMutate: () => setFailed(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: chatLinksKey }),
  });

  const confirmUnlink = (link: ChatLink, app: string) =>
    Alert.alert(tf('unlinkTitle', { app }), t('unlinkBody'), [
      { style: 'cancel', text: t('cancel') },
      { onPress: () => unlink.mutate(link), style: 'destructive', text: t('unlink') },
    ]);

  if (!platforms.data || !links.data) {
    if (platforms.error || links.error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('linkedChatsError')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              platforms.refetch();
              links.refetch();
            }}
          >
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return <ActivityIndicator style={styles.centered} />;
  }

  if (platforms.data.length === 0) {
    return <Text style={styles.message}>{t('linkedChatsEmpty')}</Text>;
  }

  return (
    <View style={styles.list}>
      <Text style={styles.intro}>{t('linkedChatsIntro')}</Text>
      {failed ? <Text style={styles.error}>{t('unlinkError')}</Text> : null}
      {platforms.data.map((platform) => {
        const app = chatAppName(platform);
        const mine = links.data.filter((link) => link.platform === platform.id);
        const steps = howToLink(platform, Platform.OS);

        return (
          <View key={platform.id} style={styles.card} testID={`chat-app-${platform.id}`}>
            <Text accessibilityRole="header" style={styles.name}>
              {app}
            </Text>
            {mine.length > 0 ? (
              mine.map((link) => (
                <View key={link.id} style={styles.linkedRow}>
                  <Text style={styles.status}>
                    {link.platformUsername
                      ? tf('linkedAs', { name: link.platformUsername })
                      : t('linked')}
                  </Text>
                  <Pressable
                    accessibilityLabel={tf('unlinkTitle', { app })}
                    accessibilityRole="button"
                    disabled={unlink.isPending}
                    onPress={() => confirmUnlink(link, app)}
                  >
                    <Text style={styles.danger}>{t('unlink')}</Text>
                  </Pressable>
                </View>
              ))
            ) : (
              <>
                <Text style={styles.status}>{t('notLinked')}</Text>
                {steps.hint ? <Text style={styles.hint}>{steps.hint}</Text> : null}
                {steps.open ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => Linking.openURL(steps.open!.url).catch(() => {})}
                    style={({ pressed }) => [styles.open, pressed && styles.pressed]}
                  >
                    <Text style={styles.openText}>{steps.open.label}</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        );
      })}
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: 12, gap: 6, padding: 16 },
    centered: { alignItems: 'center', gap: 12, paddingVertical: 48 },
    danger: { color: colors.danger, fontSize: 15 },
    error: { color: colors.danger, fontSize: 14 },
    hint: { color: colors.secondaryLabel, fontSize: 14 },
    intro: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
    link: { color: colors.accent, fontSize: 16 },
    linkedRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    list: { gap: 12 },
    message: { color: colors.secondaryLabel, fontSize: 15, textAlign: 'center' },
    name: { color: colors.label, fontSize: 17, fontWeight: '600' },
    open: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 4 },
    openText: { color: colors.accent, fontSize: 15 },
    pressed: { opacity: 0.6 },
    status: { color: colors.label, fontSize: 15 },
  });
