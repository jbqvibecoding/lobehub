import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isMainlandEdition } from '@/config/app-config';
import { t } from '@/i18n/strings';
import { authClient } from '@/lib/auth-client';
import { type Palette, useColors } from '@/theme/colors';

/** Google and Apple sign-in serve the Global edition; the mainland edition adds its own later. */
const SOCIAL_PROVIDERS = isMainlandEdition ? [] : (['apple', 'google'] as const);

export const SignInScreen = () => {
  const colors = useColors();
  const styles = createStyles(colors);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  // The session hook in the root layout switches to the approvals screen on success
  const signInWithEmail = async () => {
    if (submitting) return;
    setSubmitting(true);
    setFailed(false);

    const { error } = await authClient.signIn.email({ email: email.trim(), password });

    setFailed(!!error);
    setSubmitting(false);
  };

  const signInWith = async (provider: (typeof SOCIAL_PROVIDERS)[number]) => {
    setFailed(false);
    const { error } = await authClient.signIn.social({ callbackURL: '/', provider });
    setFailed(!!error);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.content}
      >
        <Text style={styles.brand}>Biber</Text>
        {isMainlandEdition ? <Text style={styles.edition}>{t('mainlandEdition')}</Text> : null}

        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          inputMode="email"
          onChangeText={setEmail}
          placeholder={t('email')}
          placeholderTextColor={colors.secondaryLabel}
          style={styles.input}
          value={email}
        />
        <TextInput
          autoComplete="password"
          onChangeText={setPassword}
          onSubmitEditing={signInWithEmail}
          placeholder={t('password')}
          placeholderTextColor={colors.secondaryLabel}
          secureTextEntry
          style={styles.input}
          value={password}
        />

        {failed ? <Text style={styles.error}>{t('signInError')}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={submitting || !email.trim() || !password}
          onPress={signInWithEmail}
          style={[styles.primary, (submitting || !email.trim() || !password) && styles.disabled]}
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryLabel}>{t('signIn')}</Text>
          )}
        </Pressable>

        {SOCIAL_PROVIDERS.map((provider) => (
          <Pressable
            accessibilityRole="button"
            key={provider}
            onPress={() => signInWith(provider)}
            style={styles.secondary}
          >
            <Text style={styles.secondaryLabel}>
              {provider === 'apple' ? t('signInWithApple') : t('signInWithGoogle')}
            </Text>
          </Pressable>
        ))}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    brand: { color: colors.label, fontSize: 34, fontWeight: '700', marginBottom: 4 },
    content: { flex: 1, gap: 12, justifyContent: 'center', padding: 24 },
    disabled: { opacity: 0.5 },
    edition: { color: colors.secondaryLabel, fontSize: 13, marginBottom: 8 },
    error: { color: colors.danger, fontSize: 14 },
    input: {
      backgroundColor: colors.card,
      borderRadius: 12,
      color: colors.label,
      fontSize: 16,
      minHeight: 48,
      paddingHorizontal: 14,
    },
    primary: {
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: 12,
      justifyContent: 'center',
      minHeight: 48,
    },
    primaryLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
    screen: { backgroundColor: colors.background, flex: 1 },
    secondary: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center',
      minHeight: 48,
    },
    secondaryLabel: { color: colors.label, fontSize: 16 },
  });
