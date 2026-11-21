import { Stack } from 'expo-router/stack';
import { ScrollView, StyleSheet } from 'react-native';

import { t } from '@/i18n/strings';
import { api } from '@/lib/api';
import { type Palette, useColors } from '@/theme/colors';

import { ExpertsView } from './experts';
import { LinkedChatsView } from './linked-chats';
import { MemoriesList } from './memories';
import { ProactiveSettingsView } from './proactive';

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

export const ExpertsScreen = () => (
  <>
    <Stack.Screen options={{ title: t('expertsTitle') }} />
    <ExpertsView api={api} />
  </>
);

export const MemoriesScreen = () => (
  <>
    <Stack.Screen options={{ title: t('memoriesTitle') }} />
    <MemoriesList api={api} />
  </>
);

export const ProactiveScreen = () => (
  <>
    <Stack.Screen options={{ title: t('proactiveTitle') }} />
    <ProactiveSettingsView api={api} />
  </>
);

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16 },
    screen: { backgroundColor: colors.background },
  });
