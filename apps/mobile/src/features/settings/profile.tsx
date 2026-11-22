import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getLocales } from 'expo-localization';
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

import { type Profile, PROFILE_SECTIONS, type ProfileEntry, type ProfileSection } from './types';

export const profileKey = ['profile', 'get'] as const;
export const profileStatusKey = ['profile', 'status'] as const;

const SECTION_TITLES: Record<ProfileSection, StringKey> = {
  challenges: 'profileSectionChallenges',
  goals: 'profileSectionGoals',
  ideal: 'profileSectionIdeal',
  mission: 'profileSectionMission',
  name: 'profileSectionName',
  now: 'profileSectionNow',
  people: 'profileSectionPeople',
  projects: 'profileSectionProjects',
  style: 'profileSectionStyle',
};

/** Why the server refused an entry, from the message `profile.saveEntry` fails with. */
const SAVE_FAILURES: Record<string, StringKey> = {
  PROFILE_EMPTY: 'profileSaveErrorEmpty',
  PROFILE_SECRET: 'profileSaveErrorSecret',
  PROFILE_TOO_LONG: 'profileSaveErrorTooLong',
};

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Opens the "About you" interview (starting it the first time) and says where it is. */
export const useStartInterview = (api: ApiClient) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.mutation('profile.startInterview', {
        locale: getLocales()[0]?.languageTag,
      }) as Promise<{ operationId: string; topicId: string }>,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: profileKey });
      queryClient.invalidateQueries({ queryKey: profileStatusKey });
    },
  });
};

/**
 * "About you": what the user told Biber about themselves, by section, each entry with its number
 * and when it was last true. The user changes or deletes any of it here, or opens the interview
 * to tell Biber more.
 */
export const AboutYouView = ({
  api,
  onOpenInterview,
}: {
  api: ApiClient;
  onOpenInterview: (topicId: string) => void;
}) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string>();

  const profile = useQuery({
    queryFn: () => api.query('profile.get') as Promise<Profile>,
    queryKey: profileKey,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: profileKey });
    queryClient.invalidateQueries({ queryKey: profileStatusKey });
  };
  const drop = useMutation({
    mutationFn: (id: string) => api.mutation('profile.dropEntry', { id }),
    onSettled: refresh,
  });
  const clear = useMutation({
    mutationFn: () => api.mutation('profile.clear'),
    onSettled: refresh,
  });
  const interview = useStartInterview(api);

  const openInterview = async () => {
    if (interview.isPending) return;
    try {
      const { topicId } = await interview.mutateAsync();
      onOpenInterview(topicId);
    } catch {
      // Shown below from the mutation's state
    }
  };

  const confirmDrop = (entry: ProfileEntry) =>
    Alert.alert(tf('profileDeleteTitle', { id: entry.id }), t('profileDeleteBody'), [
      { style: 'cancel', text: t('cancel') },
      { onPress: () => drop.mutate(entry.id), style: 'destructive', text: t('profileDelete') },
    ]);

  const confirmClear = () =>
    Alert.alert(t('profileClearTitle'), t('profileClearBody'), [
      { style: 'cancel', text: t('cancel') },
      { onPress: () => clear.mutate(), style: 'destructive', text: t('profileClear') },
    ]);

  if (!profile.data) {
    if (profile.error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('profileError')}</Text>
          <Pressable onPress={() => profile.refetch()} role="button">
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return <ActivityIndicator style={styles.centered} />;
  }

  const { entries } = profile.data;
  const started = !!profile.data.interview.startedAt;
  const sections = PROFILE_SECTIONS.map((section) => ({
    entries: entries.filter((entry) => entry.section === section),
    section,
  })).filter((group) => group.entries.length > 0);

  return (
    <View style={styles.list}>
      <Text style={styles.intro}>{entries.length ? t('profileIntro') : t('profileEmpty')}</Text>
      <Pressable
        aria-disabled={interview.isPending}
        disabled={interview.isPending}
        onPress={openInterview}
        role="button"
        style={({ pressed }) => [
          styles.submit,
          interview.isPending && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.submitText}>
          {interview.isPending
            ? t('profileStarting')
            : started
              ? t('profileContinueInterview')
              : t('profileStartInterview')}
        </Text>
      </Pressable>
      {interview.isError ? (
        <Text role="alert" style={styles.error}>
          {t('profileStartError')}
        </Text>
      ) : null}
      {drop.isError ? <Text style={styles.error}>{t('profileDeleteError')}</Text> : null}
      {clear.isError ? <Text style={styles.error}>{t('profileClearError')}</Text> : null}

      {sections.map((group) => (
        <View key={group.section} style={styles.section}>
          <Text role="heading" style={styles.heading}>
            {t(SECTION_TITLES[group.section])}
          </Text>
          {group.entries.map((entry) =>
            editing === entry.id ? (
              <EntryForm
                api={api}
                entry={entry}
                key={entry.id}
                onCancel={() => setEditing(undefined)}
                onSaved={() => {
                  setEditing(undefined);
                  refresh();
                }}
              />
            ) : (
              <View key={entry.id} style={styles.card} testID={`entry-${entry.id}`}>
                <Text style={styles.text}>{entry.text}</Text>
                <Text style={styles.detail}>
                  {entry.id} ·{' '}
                  {tf('profileUpdated', {
                    date: formatDay(
                      [entry.updatedAt, entry.reviewedAt].filter(Boolean).sort().at(-1)!,
                    ),
                  })}
                </Text>
                <View style={styles.buttons}>
                  <Pressable
                    aria-label={tf('profileEditLabel', { id: entry.id })}
                    onPress={() => setEditing(entry.id)}
                    role="button"
                    style={styles.action}
                  >
                    <Text style={styles.link}>{t('profileEdit')}</Text>
                  </Pressable>
                  <Pressable
                    aria-disabled={drop.isPending}
                    aria-label={tf('profileDeleteTitle', { id: entry.id })}
                    disabled={drop.isPending}
                    onPress={() => confirmDrop(entry)}
                    role="button"
                    style={styles.action}
                  >
                    <Text style={styles.danger}>{t('profileDelete')}</Text>
                  </Pressable>
                </View>
              </View>
            ),
          )}
        </View>
      ))}

      {entries.length ? (
        <Pressable
          disabled={clear.isPending}
          onPress={confirmClear}
          role="button"
          style={styles.clear}
        >
          <Text style={styles.danger}>{t('profileClear')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

/** Changing one entry's words; it keeps its number. */
const EntryForm = ({
  api,
  entry,
  onCancel,
  onSaved,
}: {
  api: ApiClient;
  entry: ProfileEntry;
  onCancel: () => void;
  onSaved: () => void;
}) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const [text, setText] = useState(entry.text);

  const save = useMutation({
    mutationFn: () =>
      api.mutation('profile.saveEntry', { id: entry.id, section: entry.section, text }),
    onSuccess: onSaved,
  });
  const failure = save.error
    ? (SAVE_FAILURES[save.error.message] ?? 'profileSaveErrorOther')
    : undefined;
  const ready = !!text.trim() && text.trim() !== entry.text && !save.isPending;

  return (
    <View style={[styles.card, styles.form]}>
      <TextInput
        accessibilityLabel={tf('profileEditLabel', { id: entry.id })}
        editable={!save.isPending}
        maxLength={500}
        multiline
        onChangeText={setText}
        style={styles.input}
        value={text}
      />
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
            {save.isPending ? t('profileSaving') : t('profileSave')}
          </Text>
        </Pressable>
        <Pressable disabled={save.isPending} onPress={onCancel} role="button">
          <Text style={styles.link}>{t('cancel')}</Text>
        </Pressable>
      </View>
    </View>
  );
};

/**
 * The first-run invite above the chat list: Biber offers a short interview to get to know the
 * user. It shows only to someone Biber knows nothing about, who has neither started the
 * interview nor said "Later".
 */
export const ProfileInvite = ({
  api,
  onOpenInterview,
}: {
  api: ApiClient;
  onOpenInterview: (topicId: string) => void;
}) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();

  const status = useQuery({
    queryFn: () => api.query('profile.status') as Promise<{ invite: boolean }>,
    queryKey: profileStatusKey,
  });
  const later = useMutation({
    mutationFn: () => api.mutation('profile.dismissInvite'),
    onSuccess: () => queryClient.setQueryData(profileStatusKey, { invite: false }),
  });
  const interview = useStartInterview(api);

  if (!status.data?.invite) return null;

  const start = async () => {
    if (interview.isPending) return;
    try {
      const { topicId } = await interview.mutateAsync();
      onOpenInterview(topicId);
    } catch {
      // Shown below from the mutation's state
    }
  };
  const busy = interview.isPending || later.isPending;

  return (
    <View style={[styles.card, styles.invite]} testID="profile-invite">
      <Text role="heading" style={styles.name}>
        {t('inviteTitle')}
      </Text>
      <Text style={styles.detail}>{t('inviteBody')}</Text>
      {interview.isError || later.isError ? (
        <Text role="alert" style={styles.error}>
          {t('inviteError')}
        </Text>
      ) : null}
      <View style={styles.buttons}>
        <Pressable
          aria-disabled={busy}
          disabled={busy}
          onPress={start}
          role="button"
          style={({ pressed }) => [
            styles.submit,
            busy && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.submitText}>
            {interview.isPending ? t('profileStarting') : t('inviteStart')}
          </Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => later.mutate()} role="button">
          <Text style={styles.link}>{t('inviteLater')}</Text>
        </Pressable>
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    action: { paddingVertical: 4 },
    buttons: { alignItems: 'center', flexDirection: 'row', gap: 20, marginTop: 4 },
    card: { backgroundColor: colors.card, borderRadius: 12, gap: 6, padding: 16 },
    centered: { alignItems: 'center', gap: 12, paddingVertical: 48 },
    clear: { alignSelf: 'flex-start', paddingVertical: 8 },
    danger: { color: colors.danger, fontSize: 15 },
    detail: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
    disabled: { opacity: 0.4 },
    error: { color: colors.danger, fontSize: 14 },
    form: { gap: 10 },
    heading: { color: colors.secondaryLabel, fontSize: 13, fontWeight: '600' },
    input: {
      backgroundColor: colors.background,
      borderRadius: 8,
      color: colors.label,
      fontSize: 16,
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    intro: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
    invite: { marginBottom: 12 },
    link: { color: colors.accent, fontSize: 15 },
    list: { gap: 12 },
    message: { color: colors.secondaryLabel, fontSize: 15, textAlign: 'center' },
    name: { color: colors.label, fontSize: 17, fontWeight: '600' },
    pressed: { opacity: 0.6 },
    section: { gap: 8 },
    submit: {
      alignSelf: 'flex-start',
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    submitText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
    text: { color: colors.label, fontSize: 16, lineHeight: 22 },
  });
