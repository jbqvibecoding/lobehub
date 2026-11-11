import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { t, tf } from '@/i18n/strings';
import { type Palette, useColors } from '@/theme/colors';

import { normalizeMainlandMobile } from './mainland-mobile';

const RESEND_AFTER_SECONDS = 60;

/** The parts of the auth client's phone-number plugin this form uses. */
export interface PhoneAuth {
  sendOtp: (input: { phoneNumber: string }) => Promise<{ error: unknown }>;
  verify: (input: { code: string; phoneNumber: string }) => Promise<{ error: unknown }>;
}

/**
 * Mainland edition: sign in, or sign up, with a code texted to a mainland China mobile number.
 * Once the code is confirmed the session is stored and the app opens.
 */
export const PhoneSignIn = ({ auth }: { auth: PhoneAuth }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const [input, setInput] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const sendCode = async () => {
    const phoneNumber = normalizeMainlandMobile(input);
    if (!phoneNumber) {
      setError(t('phoneInvalid'));
      return;
    }
    setError(undefined);
    setBusy(true);
    const { error: sendError } = await auth.sendOtp({ phoneNumber });
    setBusy(false);
    if (sendError) {
      setError(t('phoneSendFailed'));
      return;
    }
    setSentTo(phoneNumber);
    setWait(RESEND_AFTER_SECONDS);
  };

  const verify = async () => {
    if (!sentTo) return;
    setError(undefined);
    setBusy(true);
    const { error: verifyError } = await auth.verify({ code: code.trim(), phoneNumber: sentTo });
    setBusy(false);
    if (verifyError) setError(t('phoneWrongCode'));
  };

  const canVerify = !!sentTo && code.trim().length === 6 && !busy;

  return (
    <View style={styles.form}>
      <View style={styles.row}>
        <Text style={styles.prefix}>+86</Text>
        <TextInput
          accessibilityLabel={t('phoneNumber')}
          autoComplete="tel"
          inputMode="tel"
          onChangeText={setInput}
          placeholder={t('phoneNumber')}
          placeholderTextColor={colors.secondaryLabel}
          style={[styles.input, styles.grow]}
          value={input}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy || wait > 0}
          onPress={sendCode}
          style={[styles.secondary, (busy || wait > 0) && styles.disabled]}
        >
          <Text style={styles.secondaryLabel}>
            {wait > 0 ? tf('resendIn', { seconds: String(wait) }) : t('sendCode')}
          </Text>
        </Pressable>
      </View>

      {sentTo ? (
        <TextInput
          accessibilityLabel={t('verificationCode')}
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          onChangeText={setCode}
          onSubmitEditing={verify}
          placeholder={t('verificationCode')}
          placeholderTextColor={colors.secondaryLabel}
          style={styles.input}
          textContentType="oneTimeCode"
          value={code}
        />
      ) : null}

      {error ? (
        <Text role="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canVerify }}
        disabled={!canVerify}
        onPress={verify}
        style={[styles.primary, !canVerify && styles.disabled]}
      >
        {busy && sentTo ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.primaryLabel}>{t('signIn')}</Text>
        )}
      </Pressable>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    disabled: { opacity: 0.5 },
    error: { color: colors.danger, fontSize: 14 },
    form: { gap: 12 },
    grow: { flex: 1 },
    input: {
      backgroundColor: colors.card,
      borderRadius: 10,
      color: colors.label,
      fontSize: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    prefix: { color: colors.label, fontSize: 16 },
    primary: {
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: 10,
      padding: 14,
    },
    primaryLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
    row: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    secondary: { backgroundColor: colors.card, borderRadius: 10, padding: 12 },
    secondaryLabel: { color: colors.accent, fontSize: 15 },
  });
