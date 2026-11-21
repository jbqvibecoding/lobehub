import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { openBrowserAsync } from 'expo-web-browser';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { type StringKey, t, tf } from '@/i18n/strings';
import type { ApiClient } from '@/lib/api-client';
import { type Palette, useColors } from '@/theme/colors';

import { MailForm } from './mail-form';
import type { AccountApp, AccountsOverview, ConnectedAccount } from './types';

export const accountsKey = ['accounts', 'list'] as const;

/** Composio connections that existed but stopped working, as opposed to never finished. */
const STOPPED = new Set(['EXPIRED', 'FAILED', 'INACTIVE']);

/**
 * "Email & calendar": the mailbox and calendar Biber can reach, by edition. The global edition
 * connects Gmail, Google Calendar and Outlook on Composio's page; the mainland edition connects a
 * mailbox with its authorization code and the Feishu calendar on Feishu's page. Those pages open in
 * the in-app browser, and the list reloads when the person comes back.
 */
export const AccountsView = ({ api }: { api: ApiClient }) => {
  const styles = createStyles(useColors());
  const overview = useQuery({
    queryFn: () => api.query('accounts.list') as Promise<AccountsOverview>,
    queryKey: accountsKey,
  });

  if (!overview.data) {
    if (overview.error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('accountsError')}</Text>
          <Pressable onPress={() => overview.refetch()} role="button">
            <Text style={styles.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      );
    }
    return <ActivityIndicator style={styles.centered} />;
  }

  return overview.data.edition === 'cn' ? (
    <MainlandAccounts api={api} overview={overview.data} />
  ) : (
    <GlobalAccounts api={api} overview={overview.data} />
  );
};

/** Runs one connect or disconnect at a time, says when it failed, and reloads the list. */
const useAccountActions = () => {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<StringKey | null>(null);
  const action = useMutation({
    mutationFn: ({ run }: { failure: StringKey; run: () => Promise<unknown> }) => run(),
    onError: (_error, { failure }) => setFailure(failure),
    onMutate: () => setFailure(null),
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountsKey }),
  });

  return {
    busy: action.isPending,
    failure,
    reload: () => queryClient.invalidateQueries({ queryKey: accountsKey }),
    run: (failure: StringKey, run: () => Promise<unknown>) => action.mutate({ failure, run }),
  };
};

/** Asks for the page to authorize on, and keeps the action running while it is open. */
const openAuthorization = async (getUrl: () => Promise<unknown>) => {
  const { url } = (await getUrl()) as { url: string };
  await openBrowserAsync(url);
};

const confirmDisconnect = (name: string, disconnect: () => void) =>
  Alert.alert(tf('accountDisconnectTitle', { app: name }), t('accountDisconnectBody'), [
    { style: 'cancel', text: t('cancel') },
    { onPress: disconnect, style: 'destructive', text: t('accountDisconnect') },
  ]);

const GlobalAccounts = ({
  api,
  overview,
}: {
  api: ApiClient;
  overview: Extract<AccountsOverview, { edition: 'global' }>;
}) => {
  const styles = createStyles(useColors());
  const actions = useAccountActions();

  if (!overview.available) return <Text style={styles.message}>{t('accountsUnavailable')}</Text>;

  const connect = (app: AccountApp) =>
    actions.run('accountConnectError', () =>
      openAuthorization(() => api.mutation('accounts.connectComposio', { app })),
    );
  const disconnect = (app: AccountApp) =>
    actions.run('accountDisconnectError', () =>
      api.mutation('accounts.disconnectComposio', { app }),
    );

  return (
    <View style={styles.list}>
      <Text style={styles.intro}>{t('accountsIntro')}</Text>
      {actions.failure ? <Text style={styles.error}>{t(actions.failure)}</Text> : null}
      {overview.apps.map(({ app, label, status }) => {
        const connected = status === 'ACTIVE';
        const stopped = STOPPED.has(status);
        return (
          <AccountCard
            key={app}
            status={
              connected
                ? t('accountConnected')
                : stopped
                  ? t('accountNeedsReconnect')
                  : t('accountNotConnected')
            }
            testID={`account-${app}`}
            title={label}
            warning={stopped}
          >
            {connected ? (
              <ActionButton
                danger
                disabled={actions.busy}
                label={t('accountDisconnect')}
                name={tf('accountDisconnectApp', { app: label })}
                onPress={() => confirmDisconnect(label, () => disconnect(app))}
              />
            ) : (
              <ActionButton
                disabled={actions.busy}
                label={stopped ? t('accountReconnect') : t('accountConnect')}
                name={tf('accountConnectApp', { app: label })}
                onPress={() => connect(app)}
              />
            )}
          </AccountCard>
        );
      })}
    </View>
  );
};

const accountStatus = (account: ConnectedAccount) => {
  if (!account.connected) return t('accountNotConnected');
  if (account.needsReconnect) return t('accountNeedsReconnect');
  return account.label ? tf('accountConnectedAs', { name: account.label }) : t('accountConnected');
};

const MainlandAccounts = ({
  api,
  overview,
}: {
  api: ApiClient;
  overview: Extract<AccountsOverview, { edition: 'cn' }>;
}) => {
  const styles = createStyles(useColors());
  const actions = useAccountActions();
  const [mailForm, setMailForm] = useState(false);
  const { calendar, mail } = overview;
  const mailbox = t('mailboxTitle');
  const feishu = t('feishuCalendarTitle');

  const connectCalendar = () =>
    actions.run('accountConnectError', () =>
      openAuthorization(() => api.mutation('accounts.feishuCalendarAuthUrl')),
    );

  return (
    <View style={styles.list}>
      <Text style={styles.intro}>{t('accountsIntro')}</Text>
      {actions.failure ? <Text style={styles.error}>{t(actions.failure)}</Text> : null}

      <AccountCard
        status={accountStatus(mail)}
        testID="account-mail"
        title={mailbox}
        warning={mail.needsReconnect}
      >
        {mailForm ? null : (
          <View style={styles.buttons}>
            {mail.connected && !mail.needsReconnect ? null : (
              <ActionButton
                disabled={actions.busy}
                label={mail.connected ? t('accountReconnect') : t('mailConnect')}
                onPress={() => setMailForm(true)}
              />
            )}
            {mail.connected ? (
              <ActionButton
                danger
                disabled={actions.busy}
                label={t('accountDisconnect')}
                name={tf('accountDisconnectApp', { app: mailbox })}
                onPress={() =>
                  confirmDisconnect(mailbox, () =>
                    actions.run('accountDisconnectError', () =>
                      api.mutation('accounts.disconnectMail'),
                    ),
                  )
                }
              />
            ) : null}
          </View>
        )}
        {mailForm ? (
          <MailForm
            api={api}
            onCancel={() => setMailForm(false)}
            onConnected={() => {
              setMailForm(false);
              actions.reload();
            }}
            presets={mail.presets}
          />
        ) : null}
      </AccountCard>

      <AccountCard
        status={
          calendar.connected || calendar.available
            ? accountStatus(calendar)
            : t('feishuCalendarUnavailable')
        }
        testID="account-feishu-calendar"
        title={feishu}
        warning={calendar.needsReconnect}
      >
        <View style={styles.buttons}>
          {calendar.available && (!calendar.connected || calendar.needsReconnect) ? (
            <ActionButton
              disabled={actions.busy}
              label={calendar.connected ? t('accountReconnect') : t('feishuConnect')}
              onPress={connectCalendar}
            />
          ) : null}
          {calendar.connected ? (
            <ActionButton
              danger
              disabled={actions.busy}
              label={t('accountDisconnect')}
              name={tf('accountDisconnectApp', { app: feishu })}
              onPress={() =>
                confirmDisconnect(feishu, () =>
                  actions.run('accountDisconnectError', () =>
                    api.mutation('accounts.disconnectCalendar'),
                  ),
                )
              }
            />
          ) : null}
        </View>
      </AccountCard>
    </View>
  );
};

const AccountCard = ({
  children,
  status,
  testID,
  title,
  warning,
}: {
  children: ReactNode;
  status: string;
  testID: string;
  title: string;
  warning?: boolean;
}) => {
  const styles = createStyles(useColors());
  return (
    <View style={styles.card} testID={testID}>
      <Text role="heading" style={styles.name}>
        {title}
      </Text>
      <Text style={[styles.status, warning && styles.warning]}>{status}</Text>
      {children}
    </View>
  );
};

/** A text button; `name` is what a screen reader says when the label alone is ambiguous. */
const ActionButton = ({
  danger,
  disabled,
  label,
  name,
  onPress,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  name?: string;
  onPress: () => void;
}) => {
  const styles = createStyles(useColors());
  return (
    <Pressable
      aria-disabled={disabled}
      aria-label={name ?? label}
      disabled={disabled}
      onPress={onPress}
      role="button"
      style={({ pressed }) => [styles.action, (pressed || disabled) && styles.pressed]}
    >
      <Text style={danger ? styles.danger : styles.link}>{label}</Text>
    </Pressable>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    action: { paddingVertical: 4 },
    buttons: { flexDirection: 'row', gap: 20, marginTop: 4 },
    card: { backgroundColor: colors.card, borderRadius: 12, gap: 6, padding: 16 },
    centered: { alignItems: 'center', gap: 12, paddingVertical: 48 },
    danger: { color: colors.danger, fontSize: 15 },
    error: { color: colors.danger, fontSize: 14 },
    intro: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
    link: { color: colors.accent, fontSize: 15 },
    list: { gap: 12 },
    message: { color: colors.secondaryLabel, fontSize: 15, textAlign: 'center' },
    name: { color: colors.label, fontSize: 17, fontWeight: '600' },
    pressed: { opacity: 0.6 },
    status: { color: colors.label, fontSize: 15 },
    warning: { color: colors.warning },
  });
