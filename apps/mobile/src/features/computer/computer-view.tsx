import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { t } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import type { ComputerAction, ComputerView } from './types';

export const computerKey = ['computer'] as const;

/** How far one press of the scroll buttons moves the page, in page pixels. */
const SCROLL_STEP = 600;

/** About one picture a second while it runs; a stopped computer is checked now and then. */
const refreshInterval = (view?: ComputerView) =>
  view?.status === 'running' ? 1000 : view?.status === 'off' ? 10_000 : false;

type Command = 'handBack' | 'start' | 'takeOver';

/**
 * The cloud computer on the phone: the browser Biber uses, about once a second. The person can
 * take it over (to sign in, or to get Biber past a page it is stuck on), tap and type, and hand it
 * back. Biber cannot act while the person holds it.
 */
export const CloudComputerView = ({ api }: { api: ApiClient }) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [drawnWidth, setDrawnWidth] = useState(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const { data, error, refetch } = useQuery({
    queryFn: () => api.query('computer.view', { withScreen: true }) as Promise<ComputerView>,
    queryKey: computerKey,
    refetchInterval: (query) => refreshInterval(query.state.data),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: computerKey });

  const command = useMutation({
    mutationFn: (name: Command) => api.mutation(`computer.${name}`),
    onError: () => setFailed(true),
    onMutate: () => setFailed(false),
    onSettled: refresh,
  });

  /** Inputs go one after another, so taps and text arrive in order. */
  const send = (action: ComputerAction) => {
    setFailed(false);
    queue.current = queue.current
      .then(() => api.mutation('computer.input', { action }))
      .then(refresh)
      .catch(() => setFailed(true));
  };

  if (!data) {
    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('computerLoadError')}</Text>
          <Pressable accessibilityRole="button" onPress={() => refetch()}>
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return <ActivityIndicator style={styles.centered} />;
  }

  if (data.status === 'unavailable') {
    return <Text style={styles.message}>{t('computerUnavailable')}</Text>;
  }

  const button = (name: Command, label: string) => (
    <Pressable
      accessibilityRole="button"
      disabled={command.isPending}
      onPress={() => command.mutate(name)}
      style={({ pressed }) => [styles.primary, (pressed || command.isPending) && styles.pressed]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );

  const errorNotice = failed ? (
    <Text role="alert" style={styles.error}>
      {t('computerActionError')}
    </Text>
  ) : null;

  if (data.status === 'off') {
    return (
      <View style={styles.section}>
        <Text style={styles.body}>{t('computerOff')}</Text>
        {button('start', t('computerStart'))}
        {errorNotice}
      </View>
    );
  }

  const control = data.control;
  const driving = control?.holder === 'human';
  const screen = data.screen;

  const sendText = () => {
    if (!text) return;
    send({ kind: 'type', text });
    setText('');
  };

  const keyButton = (label: string, action: ComputerAction) => (
    <Pressable
      accessibilityRole="button"
      key={label}
      onPress={() => send(action)}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.section}>
      {control?.helpRequested ? (
        <View style={styles.help}>
          <Text style={styles.helpTitle}>{t('computerHelpPrefix')}</Text>
          {control.reason ? <Text style={styles.body}>{control.reason}</Text> : null}
        </View>
      ) : (
        <Text style={styles.status}>
          {t(driving ? 'computerStatusHuman' : 'computerStatusBot')}
        </Text>
      )}
      {control?.secretWanted ? (
        <SecretField api={api} label={control.secretWanted} onSupplied={refresh} />
      ) : null}

      {driving
        ? button('handBack', t('computerHandBack'))
        : button('takeOver', t('computerTakeOver'))}
      {errorNotice}

      {screen ? (
        <Pressable
          accessibilityHint={driving ? t('computerHintHuman') : t('computerHintBot')}
          accessibilityLabel={t('computerScreenLabel')}
          disabled={!driving}
          onLayout={(event) => setDrawnWidth(event.nativeEvent.layout.width)}
          onPress={(event) => {
            if (!drawnWidth) return;
            const scale = screen.width / drawnWidth;
            send({
              kind: 'click',
              x: Math.round(event.nativeEvent.locationX * scale),
              y: Math.round(event.nativeEvent.locationY * scale),
            });
          }}
          style={[styles.frame, driving && styles.driving]}
          testID="computer-screen"
        >
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: `data:image/png;base64,${screen.base64}` }}
            style={{ aspectRatio: screen.width / screen.height, width: '100%' }}
          />
        </Pressable>
      ) : (
        <Text style={styles.message}>{t('computerNoPicture')}</Text>
      )}
      {screen?.url ? <Text style={styles.caption}>{screen.url}</Text> : null}

      {driving ? (
        <>
          <View style={styles.row}>
            <TextInput
              accessibilityLabel={t('computerTypePlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setText}
              onSubmitEditing={sendText}
              placeholder={t('computerTypePlaceholder')}
              placeholderTextColor={colors.secondaryLabel}
              returnKeyType="send"
              style={styles.input}
              value={text}
            />
            <Pressable
              accessibilityRole="button"
              disabled={!text}
              onPress={sendText}
              style={({ pressed }) => [styles.chip, (pressed || !text) && styles.pressed]}
            >
              <Text style={styles.chipText}>{t('computerSend')}</Text>
            </Pressable>
          </View>
          <View style={styles.row}>
            {keyButton(t('computerEnter'), { key: 'Enter', kind: 'key' })}
            {keyButton(t('computerBackspace'), { key: 'Backspace', kind: 'key' })}
            {keyButton(t('computerScrollUp'), { deltaY: -SCROLL_STEP, kind: 'scroll' })}
            {keyButton(t('computerScrollDown'), { deltaY: SCROLL_STEP, kind: 'scroll' })}
          </View>
        </>
      ) : null}
      <Text style={styles.caption}>
        {t(driving ? 'computerHintHuman' : 'computerHintBot')} {t('computerMasked')}
      </Text>
    </View>
  );
};

/**
 * The one value Biber asked for and must not see (a code, a password), typed here into a masked
 * box and sent straight to the field it named. It is never kept, logged or shown back.
 */
const SecretField = ({
  api,
  label,
  onSupplied,
}: {
  api: ApiClient;
  label: string;
  onSupplied: () => void;
}) => {
  const colors = useColors();
  const styles = createStyles(colors);
  const [value, setValue] = useState('');
  const supply = useMutation({
    mutationFn: (text: string) => api.mutation('computer.supplySecret', { text }),
    onSuccess: () => {
      setValue('');
      onSupplied();
    },
  });
  const submit = () => {
    if (value && !supply.isPending) supply.mutate(value);
  };

  return (
    <View style={styles.help}>
      <Text style={styles.body}>
        {t('computerSecretWanted')} {label}
      </Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel={label}
          autoCapitalize="none"
          autoComplete="one-time-code"
          autoCorrect={false}
          editable={!supply.isPending}
          onChangeText={setValue}
          onSubmitEditing={submit}
          placeholder={t('computerSecretPlaceholder')}
          placeholderTextColor={colors.secondaryLabel}
          returnKeyType="done"
          secureTextEntry
          style={styles.input}
          value={value}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!value || supply.isPending}
          onPress={submit}
          style={({ pressed }) => [styles.chip, (pressed || !value) && styles.pressed]}
        >
          <Text style={styles.chipText}>{t('computerSecretSubmit')}</Text>
        </Pressable>
      </View>
      {supply.isError ? <Text style={styles.error}>{t('computerSecretError')}</Text> : null}
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    body: { color: colors.label, fontSize: 15, lineHeight: 21 },
    caption: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
    centered: { alignItems: 'center', gap: 12, paddingVertical: 48 },
    chip: {
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 10,
      justifyContent: 'center',
      minHeight: 44,
      paddingHorizontal: 12,
    },
    chipText: { color: colors.accent, fontSize: 15 },
    driving: { borderColor: colors.accent, borderWidth: 2 },
    error: { color: colors.danger, fontSize: 14 },
    frame: { borderRadius: 8, overflow: 'hidden' },
    help: { backgroundColor: colors.card, borderRadius: 12, gap: 4, padding: 12 },
    helpTitle: { color: colors.warning, fontSize: 15, fontWeight: '600' },
    input: {
      backgroundColor: colors.card,
      borderRadius: 10,
      color: colors.label,
      flex: 1,
      fontSize: 16,
      minHeight: 44,
      paddingHorizontal: 12,
    },
    link: { color: colors.accent, fontSize: 16 },
    message: { color: colors.secondaryLabel, fontSize: 15, textAlign: 'center' },
    pressed: { opacity: 0.6 },
    primary: {
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: 12,
      minHeight: 44,
      justifyContent: 'center',
      padding: 12,
    },
    primaryText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    section: { gap: 12 },
    status: { color: colors.label, fontSize: 16, fontWeight: '600' },
  });
