import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { Alert } from 'react-native';

import type { ApiClient } from '@/lib/api-client';

import { GithubView, type GithubStatus } from './github';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({})) }));

const renderView = async (status: () => GithubStatus, mutation = jest.fn(async () => ({}))) => {
  const query = jest.fn(async () => status());
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
      <GithubView api={{ mutation, query } as unknown as ApiClient} />
    </QueryClientProvider>,
  );
  return { mutation, query };
};

afterEach(() => jest.clearAllMocks());

describe('GitHub', () => {
  it('connects in the browser, then shows the account and its repositories', async () => {
    let connected = false;
    const mutation = jest.fn(async () => {
      connected = true;
      return { url: 'https://github.com/apps/biber/installations/new?state=s' };
    });
    const user = userEvent.setup();
    await renderView(
      () =>
        connected
          ? { available: true, connected: true, login: 'acme', repositories: ['acme/app'] }
          : { available: true, connected: false },
      mutation,
    );

    await user.press(await screen.findByRole('button', { name: 'Connect GitHub' }));

    expect(mutation).toHaveBeenCalledWith('github.connectUrl');
    expect(openBrowserAsync).toHaveBeenCalledWith(
      'https://github.com/apps/biber/installations/new?state=s',
    );
    expect(await screen.findByRole('heading', { name: 'acme' })).toBeOnTheScreen();
    expect(screen.getByText('acme/app')).toBeOnTheScreen();
  });

  it('disconnects only after the user confirms', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const mutation = jest.fn(async () => ({}));
    const user = userEvent.setup();
    await renderView(
      () => ({ available: true, connected: true, login: 'acme', repositories: [] }),
      mutation,
    );

    expect(await screen.findByText('No repositories chosen yet.')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Disconnect' }));
    expect(mutation).not.toHaveBeenCalled();

    const buttons = alert.mock.calls[0][2]!;
    buttons.find((button) => button.style === 'destructive')!.onPress!();
    await waitFor(() => expect(mutation).toHaveBeenCalledWith('github.disconnect'));
  });

  it('says so when the service has no GitHub app', async () => {
    await renderView(() => ({ available: false, connected: false }));

    expect(
      await screen.findByText('This Biber service has no GitHub app set up.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Connect GitHub' })).not.toBeOnTheScreen();
  });
});
