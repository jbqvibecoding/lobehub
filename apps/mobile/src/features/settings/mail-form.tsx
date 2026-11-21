import { useMutation } from '@tanstack/react-query';
import { type ComponentProps, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { type StringKey, t } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import type { MailPreset } from './types';

type Provider = MailPreset | 'other';

const PROVIDER_NAMES: Record<Provider, StringKey> = {
  '126': 'mailProvider126',
  '163': 'mailProvider163',
  'aliyun': 'mailProviderAliyun',
  'exmail': 'mailProviderExmail',
  'other': 'mailProviderOther',
  'qiye163': 'mailProviderQiye163',
  'qq': 'mailProviderQq',
};

/** Why the server refused the mailbox, from the message `accounts.connectMail` fails with. */
const FAILURES: Record<string, StringKey> = {
  MAIL_AUTH: 'mailErrorAuth',
  MAIL_HOST: 'mailErrorHost',
  MAIL_UNREACHABLE: 'mailErrorUnreachable',
};

const isPort = (value: string) => /^\d{1,5}$/.test(value) && Number(value) <= 65_535;

/**
 * Connecting a mailbox in the mainland edition: the provider (optional for QQ, 163 and 126
 * addresses, which the server recognizes), the address and its authorization code, or the servers
 * for any other mailbox. The server logs in before it keeps anything; when it cannot, the form says
 * why and keeps what was typed.
 */
export const MailForm = ({
  api,
  onCancel,
  onConnected,
  presets,
}: {
  api: ApiClient;
  onCancel: () => void;
  onConnected: () => void;
  presets: MailPreset[];
}) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');

  const connect = useMutation({
    mutationFn: () =>
      api.mutation('accounts.connectMail', {
        address: address.trim(),
        password,
        ...(provider === 'other'
          ? {
              servers: {
                imapHost: imapHost.trim(),
                imapPort: Number(imapPort),
                smtpHost: smtpHost.trim(),
                smtpPort: Number(smtpPort),
              },
            }
          : provider && { preset: provider }),
      }),
    onSuccess: onConnected,
  });

  const failure = connect.error ? (FAILURES[connect.error.message] ?? 'mailErrorOther') : undefined;
  const serversReady =
    provider !== 'other' ||
    (!!imapHost.trim() && !!smtpHost.trim() && isPort(imapPort) && isPort(smtpPort));
  const ready = !!address.trim() && !!password && serversReady && !connect.isPending;

  const field = (
    label: StringKey,
    value: string,
    onChange: (value: string) => void,
    options: Partial<ComponentProps<typeof TextInput>> = {},
  ) => (
    <TextInput
      accessibilityLabel={t(label)}
      autoCapitalize="none"
      autoCorrect={false}
      editable={!connect.isPending}
      onChangeText={onChange}
      placeholder={t(label)}
      placeholderTextColor={colors.secondaryLabel}
      style={styles.input}
      value={value}
      {...options}
    />
  );

  return (
    <View style={styles.form}>
      <Text style={styles.label}>{t('mailProvider')}</Text>
      <View accessibilityLabel={t('mailProvider')} role="radiogroup" style={styles.providers}>
        {[...presets, 'other' as const].map((id) => {
          const selected = provider === id;
          return (
            <Pressable
              aria-checked={selected}
              disabled={connect.isPending}
              key={id}
              onPress={() => setProvider(selected ? null : id)}
              role="radio"
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {t(PROVIDER_NAMES[id])}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{t('mailProviderHint')}</Text>

      {field('mailAddress', address, setAddress, {
        autoComplete: 'email',
        inputMode: 'email',
      })}
      {field('mailAuthCode', password, setPassword, {
        autoComplete: 'off',
        secureTextEntry: true,
        textContentType: 'none',
      })}
      <Text style={styles.hint}>{t('mailAuthCodeHint')}</Text>

      {provider === 'other' ? (
        <>
          <View style={styles.serverRow}>
            <View style={styles.grow}>{field('mailImapHost', imapHost, setImapHost)}</View>
            <View style={styles.port}>
              {field('mailImapPort', imapPort, setImapPort, { inputMode: 'numeric' })}
            </View>
          </View>
          <View style={styles.serverRow}>
            <View style={styles.grow}>{field('mailSmtpHost', smtpHost, setSmtpHost)}</View>
            <View style={styles.port}>
              {field('mailSmtpPort', smtpPort, setSmtpPort, { inputMode: 'numeric' })}
            </View>
          </View>
        </>
      ) : null}

      {failure ? (
        <Text role="alert" style={styles.error}>
          {t(failure)}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          aria-disabled={!ready}
          disabled={!ready}
          onPress={() => connect.mutate()}
          role="button"
          style={({ pressed }) => [
            styles.submit,
            !ready && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.submitText}>
            {connect.isPending ? t('mailConnecting') : t('mailSubmit')}
          </Text>
        </Pressable>
        <Pressable disabled={connect.isPending} onPress={onCancel} role="button">
          <Text style={styles.cancel}>{t('cancel')}</Text>
        </Pressable>
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    actions: { alignItems: 'center', flexDirection: 'row', gap: 20, marginTop: 4 },
    cancel: { color: colors.accent, fontSize: 15 },
    chip: {
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.label, fontSize: 14 },
    chipTextSelected: { color: '#ffffff', fontWeight: '600' },
    disabled: { opacity: 0.4 },
    error: { color: colors.danger, fontSize: 14 },
    form: { gap: 10, marginTop: 8 },
    grow: { flex: 1 },
    hint: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
    input: {
      backgroundColor: colors.background,
      borderRadius: 8,
      color: colors.label,
      fontSize: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    label: { color: colors.label, fontSize: 15, fontWeight: '500' },
    port: { width: 88 },
    pressed: { opacity: 0.6 },
    providers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    serverRow: { flexDirection: 'row', gap: 8 },
    submit: {
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    submitText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  });
