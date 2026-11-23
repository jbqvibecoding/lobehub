import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { ScrollView, StyleSheet } from 'react-native';

import { t } from '@/i18n/strings';
import { api } from '@/lib/api';
import { type Palette, useColors } from '@/theme/colors';

import { AccountsView } from './accounts';
import { ExpertsView } from './experts';
import { GithubView } from './github';
import { LinkedChatsView } from './linked-chats';
import { SavedLoginsView } from './logins';
import { AboutYouView } from './profile';
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

export const AccountsScreen = () => {
  const styles = createStyles(useColors());

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
    >
      <Stack.Screen options={{ title: t('accountsTitle') }} />
      <AccountsView api={api} />
    </ScrollView>
  );
};

export const SavedLoginsScreen = () => {
  const styles = createStyles(useColors());

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
    >
      <Stack.Screen options={{ title: t('loginsTitle') }} />
      <SavedLoginsView api={api} />
    </ScrollView>
  );
};

export const GithubScreen = () => {
  const styles = createStyles(useColors());

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
    >
      <Stack.Screen options={{ title: t('githubTitle') }} />
      <GithubView api={api} />
    </ScrollView>
  );
};

export const AboutYouScreen = () => {
  const styles = createStyles(useColors());

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
    >
      <Stack.Screen options={{ title: t('profileTitle') }} />
      <AboutYouView
        api={api}
        onOpenInterview={(topicId) =>
          router.push({ params: { topicId }, pathname: '/chat/[topicId]' })
        }
      />
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
