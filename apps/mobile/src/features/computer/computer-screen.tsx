import { Stack } from 'expo-router/stack';
import { ScrollView, StyleSheet } from 'react-native';

import { t } from '@/i18n/strings';
import { api } from '@/lib/api';
import { type Palette, useColors } from '@/theme/colors';

import { CloudComputerView } from './computer-view';

export const CloudComputerScreen = () => {
  const colors = useColors();
  const styles = createStyles(colors);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
    >
      <Stack.Screen options={{ title: t('computerTitle') }} />
      <CloudComputerView api={api} />
    </ScrollView>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16 },
    screen: { backgroundColor: colors.background },
  });
