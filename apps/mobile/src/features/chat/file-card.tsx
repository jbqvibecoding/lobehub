import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { t, tf } from '@/i18n/strings';
import { type Palette, useColors } from '@/theme/colors';

import type { ChatFile } from './types';

const ICONS: Record<string, string> = {
  csv: '🗒️',
  docx: '📝',
  html: '🌐',
  md: '🗒️',
  pdf: '📄',
  pptx: '📊',
  xlsx: '📈',
};

const formatSize = (bytes?: number) => {
  if (!bytes) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/** A file someone handed over in the chat: what it is, and a way to open or share it. */
export const FileCard = ({ file }: { file: ChatFile }) => {
  const styles = createStyles(useColors());
  const [failed, setFailed] = useState(false);
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const size = formatSize(file.size);

  const open = () => {
    setFailed(false);
    Linking.openURL(file.url).catch(() => setFailed(true));
  };

  return (
    <View style={styles.card} testID={`file-${file.id}`}>
      <Text style={styles.icon}>{ICONS[extension] ?? '📎'}</Text>
      <View style={styles.body}>
        <Text numberOfLines={2} style={styles.name}>
          {file.name}
        </Text>
        <Text style={styles.detail}>
          {[extension.toUpperCase(), size].filter(Boolean).join(' · ')}
        </Text>
        {failed ? (
          <Text role="alert" style={styles.error}>
            {t('chatFileOpenError')}
          </Text>
        ) : null}
      </View>
      <Pressable
        aria-label={tf('chatFileOpenLabel', { name: file.name })}
        onPress={open}
        role="button"
        style={({ pressed }) => [styles.open, pressed && styles.pressed]}
      >
        <Text style={styles.openText}>{t('chatFileOpen')}</Text>
      </Pressable>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    body: { flex: 1, gap: 2 },
    card: {
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 12,
      flexDirection: 'row',
      gap: 12,
      marginVertical: 4,
      padding: 12,
    },
    detail: { color: colors.secondaryLabel, fontSize: 13 },
    error: { color: colors.danger, fontSize: 13 },
    icon: { fontSize: 28 },
    name: { color: colors.label, fontSize: 15, fontWeight: '600' },
    open: { paddingHorizontal: 8, paddingVertical: 6 },
    openText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
