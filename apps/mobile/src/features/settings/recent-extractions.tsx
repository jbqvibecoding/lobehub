import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { t, tf } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import type { ExtractionUndo, MemoryExtraction } from './types';

/** Under the memories key, so anything that refreshes the memories refreshes this too. */
export const recentExtractionsKey = ['memories', 'extractions'] as const;

const formatTime = (date: Date) =>
  new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const whatItDid = (item: MemoryExtraction) =>
  [
    item.added > 0 ? tf('memoryExtractionAdded', { count: String(item.added) }) : null,
    item.changed > 0 ? tf('memoryExtractionChanged', { count: String(item.changed) }) : null,
  ]
    .filter(Boolean)
    .join(t('listSeparator'));

/**
 * What Biber learned from each of the latest chats, with a way to take it back: undoing forgets
 * what that chat taught, restores what it changed, and stops Biber learning from it again.
 */
export const RecentExtractions = ({ api }: { api: ApiClient }) => {
  const styles = createStyles(useColors());
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<{ error: boolean; text: string }>();

  const { data: extractions = [] } = useQuery({
    queryFn: () => api.query('memories.recentExtractions') as Promise<MemoryExtraction[]>,
    queryKey: recentExtractionsKey,
  });

  const undo = useMutation({
    mutationFn: (id: string) =>
      api.mutation('memories.undoExtraction', { id }) as Promise<ExtractionUndo>,
    onError: () => setNotice({ error: true, text: t('memoryExtractionUndoError') }),
    onMutate: () => setNotice(undefined),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['memories'] }),
    onSuccess: (result) => {
      if (result.undone && result.notRestored.length > 0) {
        setNotice({
          error: false,
          text: tf('memoryExtractionNotRestored', {
            titles: result.notRestored.join(t('listSeparator')),
          }),
        });
      }
    },
  });

  if (extractions.length === 0 && !notice) return null;

  return (
    <View style={styles.section}>
      {notice ? (
        <Text role="alert" style={notice.error ? styles.error : styles.notice}>
          {notice.text}
        </Text>
      ) : null}
      {extractions.length > 0 ? (
        <Text accessibilityRole="header" style={styles.heading}>
          {t('memoryExtractionsHeading')}
        </Text>
      ) : null}
      {extractions.map((item) => {
        const source = item.topicTitle
          ? tf('memoryExtractionFrom', { title: item.topicTitle })
          : t('memoryExtractionUntitled');
        return (
          <View key={item.id} style={styles.row}>
            <View style={styles.text}>
              <Text style={styles.source}>{source}</Text>
              <Text style={styles.meta}>
                {`${whatItDid(item)} · ${formatTime(item.createdAt)}`}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={`${t('memoryExtractionUndo')}: ${source}`}
              accessibilityRole="button"
              disabled={undo.isPending}
              hitSlop={8}
              onPress={() =>
                Alert.alert(t('memoryExtractionUndoTitle'), t('memoryExtractionUndoBody'), [
                  { style: 'cancel', text: t('cancel') },
                  {
                    onPress: () => undo.mutate(item.id),
                    style: 'destructive',
                    text: t('memoryExtractionUndo'),
                  },
                ])
              }
              style={({ pressed }) => [styles.undo, pressed && styles.pressed]}
            >
              <Text style={styles.undoLabel}>{t('memoryExtractionUndo')}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    error: { color: colors.danger, fontSize: 14 },
    heading: { color: colors.secondaryLabel, fontSize: 13, fontWeight: '600', marginTop: 8 },
    meta: { color: colors.secondaryLabel, fontSize: 13 },
    notice: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
    pressed: { opacity: 0.6 },
    row: {
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 12,
      flexDirection: 'row',
      gap: 12,
      padding: 14,
    },
    section: { gap: 8, marginBottom: 8 },
    source: { color: colors.label, fontSize: 15, fontWeight: '600' },
    text: { flex: 1, gap: 2 },
    undo: { paddingVertical: 4 },
    undoLabel: { color: colors.accent, fontSize: 15 },
  });
