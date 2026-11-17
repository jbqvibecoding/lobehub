import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCalendars, getLocales } from 'expo-localization';
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { t } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import { taskBoardKey } from './use-tasks';

interface StarterRoutine {
  description: string;
  enabled: boolean;
  id: string;
  name: string;
}

export const routinesKey = ['routines'] as const;

/**
 * Routines Biber can run on a schedule (a morning brief and the like), each turned on and off with
 * a switch. The card hides itself when the list cannot load: the board below still works.
 */
export const StarterRoutines = ({ api }: { api: ApiClient }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const locale = getLocales()[0]?.languageTag;

  const { data } = useQuery({
    queryFn: () => api.query('routines.list', { locale }) as Promise<StarterRoutine[]>,
    queryKey: routinesKey,
  });

  const toggle = useMutation({
    mutationFn: ({ enabled, id }: { enabled: boolean; id: string }) =>
      enabled
        ? api.mutation('routines.enable', {
            id,
            locale,
            timeZone: getCalendars()[0]?.timeZone ?? undefined,
          })
        : api.mutation('routines.disable', { id }),
    onError: () => setFailed(true),
    onMutate: () => setFailed(false),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: routinesKey }),
        queryClient.invalidateQueries({ queryKey: taskBoardKey }),
      ]),
  });

  if (!data?.length) return null;

  return (
    <View style={styles.card}>
      <Text role="heading" style={styles.title}>
        {t('routinesTitle')}
      </Text>
      <Text style={styles.hint}>{t('routinesHint')}</Text>
      {data.map((routine) => (
        <View key={routine.id} style={styles.row}>
          <View style={styles.text}>
            <Text style={styles.name}>{routine.name}</Text>
            <Text style={styles.description}>{routine.description}</Text>
          </View>
          <Switch
            accessibilityLabel={routine.name}
            disabled={toggle.isPending}
            onValueChange={(enabled) => toggle.mutate({ enabled, id: routine.id })}
            trackColor={{ true: colors.accent }}
            value={
              toggle.isPending && toggle.variables?.id === routine.id
                ? toggle.variables.enabled
                : routine.enabled
            }
          />
        </View>
      ))}
      {failed ? (
        <Text role="alert" style={styles.error}>
          {t('routinesError')}
        </Text>
      ) : null}
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: 12, gap: 12, marginBottom: 8, padding: 14 },
    description: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18, marginTop: 2 },
    error: { color: colors.danger, fontSize: 14 },
    hint: { color: colors.secondaryLabel, fontSize: 14 },
    name: { color: colors.label, fontSize: 16, fontWeight: '600' },
    row: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 44 },
    text: { flex: 1 },
    title: { color: colors.label, fontSize: 17, fontWeight: '700' },
  });
