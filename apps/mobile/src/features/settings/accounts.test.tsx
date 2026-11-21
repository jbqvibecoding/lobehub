import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { render, screen, userEvent, within } from '@testing-library/react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { Alert } from 'react-native';

import type { ApiClient } from '@/lib/api-client';

import { AccountsView } from './accounts';
import type { AccountsOverview } from './types';

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(async () => ({ type: 'dismiss' })),
}));

const failure = (message: string) =>
  TRPCClientError.from({
    error: { code: -32_000, data: { code: 'BAD_REQUEST' }, message },
  } as never);

const globalOverview = (
  status: Record<string, string> = {},
  available = true,
): AccountsOverview => ({
  apps: [
    { app: 'gmail', label: 'Gmail', status: status.gmail ?? 'NONE' },
    {
      app: 'google-calendar',
      label: 'Google Calendar',
      status: status['google-calendar'] ?? 'NONE',
    },
    { app: 'outlook-mail', label: 'Outlook Mail', status: status['outlook-mail'] ?? 'NONE' },
  ],
  available,
  edition: 'global',
});

const mainlandOverview = ({
  calendar = {},
  mail = {},
}: {
  calendar?: Partial<Extract<AccountsOverview, { edition: 'cn' }>['calendar']>;
  mail?: Partial<Extract<AccountsOverview, { edition: 'cn' }>['mail']>;
} = {}): AccountsOverview => ({
  calendar: { available: true, connected: false, needsReconnect: false, ...calendar },
  edition: 'cn',
  mail: {
    connected: false,
    needsReconnect: false,
    presets: ['qq', '163', '126', 'exmail', 'aliyun', 'qiye163'],
    ...mail,
  },
});

const renderView = async ({
  mutation = jest.fn(async () => ({})),
  overview,
}: {
  mutation?: jest.Mock;
  overview: () => AccountsOverview;
}) => {
  const query = jest.fn(async () => overview());
  await render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            mutations: { retry: false },
            queries: { gcTime: Infinity, retry: false },
          },
        })
      }
    >
      <AccountsView api={{ mutation, query } as unknown as ApiClient} />
    </QueryClientProvider>,
  );
  return { mutation, query };
};

/** Taps the destructive button of the confirmation the screen raises. */
const confirmAlerts = () =>
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    buttons?.find((button) => button.style === 'destructive')?.onPress?.();
  });

afterEach(() => jest.clearAllMocks());

describe('Email & calendar, global edition', () => {
  it('connects Gmail on the page Composio gives, and shows it connected on return', async () => {
    let status = 'NONE';
    const mutation = jest.fn(async () => {
      status = 'ACTIVE';
      return { url: 'https://connect.composio.dev/link/abc' };
    });
    await renderView({ mutation, overview: () => globalOverview({ gmail: status }) });

    const gmail = await screen.findByTestId('account-gmail');
    expect(within(gmail).getByText('Not connected')).toBeOnTheScreen();

    await userEvent.press(screen.getByRole('button', { name: 'Connect Gmail' }));

    expect(mutation).toHaveBeenCalledWith('accounts.connectComposio', { app: 'gmail' });
    expect(openBrowserAsync).toHaveBeenCalledWith('https://connect.composio.dev/link/abc');
    expect(await within(gmail).findByText('Connected')).toBeOnTheScreen();
  });

  it('disconnects only after the person confirms', async () => {
    const mutation = jest.fn(async () => ({ disconnected: true }));
    await renderView({ mutation, overview: () => globalOverview({ 'outlook-mail': 'ACTIVE' }) });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    await userEvent.press(await screen.findByRole('button', { name: 'Disconnect Outlook Mail' }));
    expect(alert).toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();

    confirmAlerts();
    await userEvent.press(screen.getByRole('button', { name: 'Disconnect Outlook Mail' }));
    expect(mutation).toHaveBeenCalledWith('accounts.disconnectComposio', { app: 'outlook-mail' });
  });

  it('asks to reconnect an expired connection, and says when connecting fails', async () => {
    await renderView({
      mutation: jest.fn(async () => {
        throw failure('COMPOSIO_UNAVAILABLE');
      }),
      overview: () => globalOverview({ 'google-calendar': 'EXPIRED' }),
    });

    const calendar = await screen.findByTestId('account-google-calendar');
    expect(within(calendar).getByText('Stopped working. Connect it again.')).toBeOnTheScreen();

    await userEvent.press(
      within(calendar).getByRole('button', { name: 'Connect Google Calendar' }),
    );

    expect(await screen.findByText('Could not start connecting. Try again.')).toBeOnTheScreen();
    expect(openBrowserAsync).not.toHaveBeenCalled();
  });

  it('says when this service has no email and calendar', async () => {
    await renderView({ overview: () => globalOverview({}, false) });

    expect(
      await screen.findByText('Email and calendar are not set up on this service yet.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Connect Gmail' })).not.toBeOnTheScreen();
  });
});

describe('Email & calendar, mainland edition', () => {
  it('connects a mailbox with its authorization code', async () => {
    let mail = {};
    const mutation = jest.fn(async () => {
      mail = { connected: true, label: 'ada@qq.com' };
      return { label: 'ada@qq.com' };
    });
    await renderView({ mutation, overview: () => mainlandOverview({ mail }) });

    await userEvent.press(await screen.findByRole('button', { name: 'Connect mailbox' }));
    await userEvent.press(screen.getByRole('radio', { name: 'QQ Mail' }));
    await userEvent.type(screen.getByLabelText('Email address'), 'ada@qq.com');
    await userEvent.type(screen.getByLabelText('Authorization code'), 'abcdefgh');
    await userEvent.press(screen.getByRole('button', { name: 'Connect' }));

    expect(mutation).toHaveBeenCalledWith('accounts.connectMail', {
      address: 'ada@qq.com',
      password: 'abcdefgh',
      preset: 'qq',
    });
    expect(await screen.findByText('Connected as ada@qq.com')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Authorization code')).not.toBeOnTheScreen();
  });

  it('says why the mailbox was refused and keeps what was typed', async () => {
    await renderView({
      mutation: jest.fn(async () => {
        throw failure('MAIL_AUTH');
      }),
      overview: () => mainlandOverview(),
    });

    await userEvent.press(await screen.findByRole('button', { name: 'Connect mailbox' }));
    await userEvent.type(screen.getByLabelText('Email address'), 'ada@163.com');
    await userEvent.type(screen.getByLabelText('Authorization code'), 'wrong-code');
    await userEvent.press(screen.getByRole('button', { name: 'Connect' }));

    expect(
      await screen.findByText(
        'The mailbox refused this address or authorization code. Check them and try again.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Email address')).toHaveDisplayValue('ada@163.com');
    expect(screen.getByLabelText('Authorization code')).toHaveDisplayValue('wrong-code');
  });

  it('takes the servers of any other mailbox', async () => {
    const mutation = jest.fn(async () => ({ label: 'ada@example.cn' }));
    await renderView({ mutation, overview: () => mainlandOverview() });

    await userEvent.press(await screen.findByRole('button', { name: 'Connect mailbox' }));
    await userEvent.press(screen.getByRole('radio', { name: 'Other' }));
    await userEvent.type(screen.getByLabelText('Email address'), 'ada@example.cn');
    await userEvent.type(screen.getByLabelText('Authorization code'), 'secret');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('IMAP server'), 'imap.example.cn');
    await userEvent.type(screen.getByLabelText('SMTP server'), 'smtp.example.cn');
    await userEvent.clear(screen.getByLabelText('SMTP port'));
    await userEvent.type(screen.getByLabelText('SMTP port'), '587');
    await userEvent.press(screen.getByRole('button', { name: 'Connect' }));

    expect(mutation).toHaveBeenCalledWith('accounts.connectMail', {
      address: 'ada@example.cn',
      password: 'secret',
      servers: {
        imapHost: 'imap.example.cn',
        imapPort: 993,
        smtpHost: 'smtp.example.cn',
        smtpPort: 587,
      },
    });
  });

  it('connects the Feishu calendar on Feishu’s page', async () => {
    const mutation = jest.fn(async () => ({
      url: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=x',
    }));
    await renderView({ mutation, overview: () => mainlandOverview() });

    await userEvent.press(await screen.findByRole('button', { name: 'Connect Feishu calendar' }));

    expect(mutation).toHaveBeenCalledWith('accounts.feishuCalendarAuthUrl');
    expect(openBrowserAsync).toHaveBeenCalledWith(
      'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=x',
    );
  });

  it('shows a mailbox that stopped working and a calendar this service cannot connect', async () => {
    await renderView({
      overview: () =>
        mainlandOverview({
          calendar: { available: false },
          mail: { connected: true, label: 'ada@qq.com', needsReconnect: true },
        }),
    });

    const mail = await screen.findByTestId('account-mail');
    expect(within(mail).getByText('Stopped working. Connect it again.')).toBeOnTheScreen();
    expect(within(mail).getByRole('button', { name: 'Connect again' })).toBeOnTheScreen();
    expect(within(mail).getByRole('button', { name: 'Disconnect Mailbox' })).toBeOnTheScreen();

    const calendar = screen.getByTestId('account-feishu-calendar');
    expect(
      within(calendar).getByText('Feishu calendar is not set up on this service yet.'),
    ).toBeOnTheScreen();
    expect(within(calendar).queryByRole('button')).not.toBeOnTheScreen();
  });
});
