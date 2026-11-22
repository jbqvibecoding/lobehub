import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { type StringKey, t, tf } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import type { SavedLogin } from './types';

export const loginsKey = ['logins', 'list'] as const;

/** Why the server refused a login, from the message `logins.create` fails with. */
const FAILURES: Record<string, StringKey> = {
  LOGIN_LIMIT: 'loginErrorLimit',
  LOGIN_SITE: 'loginErrorSite',
};

/**
 * "Saved logins": the website logins Biber may sign in with on its cloud computer, each bound to
 * one site. The password goes in once, here, and is never shown again, to anyone; Biber signs in
 * with it only after the user approves, and only on that site.
 */
export const SavedLoginsView = ({ api }: { api: ApiClient }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const logins = useQuery({
    queryFn: () => api.query('logins.list') as Promise<SavedLogin[]>,
    queryKey: loginsKey,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.mutation('logins.delete', { id }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: loginsKey }),
  });

  const confirmRemove = (login: SavedLogin) =>
    Alert.alert(tf('loginDeleteTitle', { name: login.label }), t('loginDeleteBody'), [
      { style: 'cancel', text: t('cancel') },
      { onPress: () => remove.mutate(login.id), style: 'destructive', text: t('loginDelete') },
    ]);

  if (!logins.data) {
    if (logins.error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('loginsError')}</Text>
          <Pressable onPress={() => logins.refetch()} role="button">
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return <ActivityIndicator style={styles.centered} />;
  }

  return (
    <View style={styles.list}>
      <Text style={styles.intro}>{t('loginsIntro')}</Text>
      {remove.isError ? <Text style={styles.error}>{t('loginDeleteError')}</Text> : null}
      {logins.data.length === 0 && !adding ? (
        <Text style={styles.message}>{t('loginsEmpty')}</Text>
      ) : null}
      {logins.data.map((login) => (
        <View key={login.id} style={styles.card} testID={`login-${login.id}`}>
          <Text role="heading" style={styles.name}>
            {login.label}
          </Text>
          <Text style={styles.detail}>{login.site}</Text>
          {login.account ? <Text style={styles.detail}>{login.account}</Text> : null}
          <Pressable
            aria-disabled={remove.isPending}
            aria-label={tf('loginDeleteTitle', { name: login.label })}
            disabled={remove.isPending}
            onPress={() => confirmRemove(login)}
            role="button"
            style={styles.action}
          >
            <Text style={styles.danger}>{t('loginDelete')}</Text>
          </Pressable>
        </View>
      ))}
      {adding ? (
        <LoginForm
          api={api}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            queryClient.invalidateQueries({ queryKey: loginsKey });
          }}
        />
      ) : (
        <Pressable onPress={() => setAdding(true)} role="button" style={styles.add}>
          <Text style={styles.link}>{t('loginAdd')}</Text>
        </Pressable>
      )}
    </View>
  );
};

/** Adding a login: the site, the user name, the password (masked) and an optional name. */
const LoginForm = ({
  api,
  onCancel,
  onSaved,
}: {
  api: ApiClient;
  onCancel: () => void;
  onSaved: () => void;
}) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const [site, setSite] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.mutation('logins.create', {
        password,
        site: site.trim(),
        ...(username.trim() && { username: username.trim() }),
        ...(label.trim() && { label: label.trim() }),
      }),
    onSuccess: onSaved,
  });
  const failure = save.error ? (FAILURES[save.error.message] ?? 'loginErrorOther') : undefined;
  const ready = !!site.trim() && !!password && !save.isPending;

  const field = (
    name: StringKey,
    value: string,
    onChange: (value: string) => void,
    options: { autoComplete?: 'off' | 'url' | 'username'; secure?: boolean } = {},
  ) => (
    <TextInput
      accessibilityLabel={t(name)}
      autoCapitalize="none"
      autoComplete={options.autoComplete ?? 'off'}
      autoCorrect={false}
      editable={!save.isPending}
      onChangeText={onChange}
      placeholder={t(name)}
      placeholderTextColor={colors.secondaryLabel}
      secureTextEntry={options.secure}
      style={styles.input}
      value={value}
    />
  );

  return (
    <View style={[styles.card, styles.form]}>
      {field('loginSite', site, setSite, { autoComplete: 'url' })}
      {field('loginUsername', username, setUsername, { autoComplete: 'username' })}
      {field('loginPassword', password, setPassword, { secure: true })}
      {field('loginLabel', label, setLabel)}
      <Text style={styles.hint}>{t('loginFormHint')}</Text>
      {failure ? (
        <Text role="alert" style={styles.error}>
          {t(failure)}
        </Text>
      ) : null}
      <View style={styles.buttons}>
        <Pressable
          aria-disabled={!ready}
          disabled={!ready}
          onPress={() => save.mutate()}
          role="button"
          style={({ pressed }) => [
            styles.submit,
            !ready && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.submitText}>
            {save.isPending ? t('loginSaving') : t('loginSave')}
          </Text>
        </Pressable>
        <Pressable disabled={save.isPending} onPress={onCancel} role="button">
          <Text style={styles.link}>{t('cancel')}</Text>
        </Pressable>
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    action: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 4 },
    add: { alignSelf: 'flex-start', paddingVertical: 8 },
    buttons: { alignItems: 'center', flexDirection: 'row', gap: 20, marginTop: 4 },
    card: { backgroundColor: colors.card, borderRadius: 12, gap: 6, padding: 16 },
    centered: { alignItems: 'center', gap: 12, paddingVertical: 48 },
    danger: { color: colors.danger, fontSize: 15 },
    detail: { color: colors.secondaryLabel, fontSize: 14 },
    disabled: { opacity: 0.4 },
    error: { color: colors.danger, fontSize: 14 },
    form: { gap: 10 },
    hint: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
    input: {
      backgroundColor: colors.background,
      borderRadius: 8,
      color: colors.label,
      fontSize: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    intro: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
    link: { color: colors.accent, fontSize: 15 },
    list: { gap: 12 },
    message: { color: colors.secondaryLabel, fontSize: 15, textAlign: 'center' },
    name: { color: colors.label, fontSize: 17, fontWeight: '600' },
    pressed: { opacity: 0.6 },
    submit: {
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    submitText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  });
