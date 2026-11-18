import { Stack } from 'expo-router/stack';
import { ScrollView, StyleSheet } from 'react-native';

import { t } from '@/i18n/strings';
import { api } from '@/lib/api';
import { type Palette, useColors } from '@/theme/colors';

import { LinkedChatsView } from './linked-chats';
import { MemoriesList } from './memories';

export const LinkedChatsScreen = () => {
  const styles = createStyles(useColors());

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
    >
      <Stack.Screen options={{ title: t('linkedChatsTitle') }} />
      <LinkedChatsView api={api} />
    </ScrollView>
  );
};

export const MemoriesScreen = () => (
  <>
    <Stack.Screen options={{ title: t('memoriesTitle') }} />
    <MemoriesList api={api} />
  </>
);

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16 },
    screen: { backgroundColor: colors.background },
  });
