import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent, within } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

import type { ApiClient } from '@/lib/api-client';

import { LinkedChatsView } from './linked-chats';
import type { ChatLink, ChatPlatform } from './types';

const platforms: ChatPlatform[] = [
  { botUsername: 'BiberBot', id: 'telegram', name: 'Telegram' },
  { id: 'wechat', name: 'WeChat' },
];

const renderView = async ({
  links = [],
  mutation = jest.fn(async () => ({ success: true })),
}: {
  links?: ChatLink[] | (() => Promise<ChatLink[]>);
  mutation?: jest.Mock;
} = {}) => {
  const query = jest.fn(async (path: string) => {
    if (path === 'messenger.availablePlatforms') return platforms;
    return typeof links === 'function' ? links() : links;
  });
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
      <LinkedChatsView api={{ mutation, query } as unknown as ApiClient} />
    </QueryClientProvider>,
  );
  return { mutation, query };
};

/** Taps the destructive button of the confirmation the screen raises. */
const confirmAlerts = () =>
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    buttons?.find((button) => button.style === 'destructive')?.onPress?.();
  });

afterEach(() => jest.restoreAllMocks());

describe('LinkedChatsView', () => {
  it('shows which chat apps are linked, and how to link the others', async () => {
    await renderView({
      links: [{ id: 'l1', platform: 'telegram', platformUsername: 'ada' }],
    });

    const telegram = await screen.findByTestId('chat-app-telegram');
    expect(within(telegram).getByText('Linked as ada')).toBeOnTheScreen();
    const wechat = screen.getByTestId('chat-app-wechat');
    expect(within(wechat).getByText('Not linked')).toBeOnTheScreen();
    expect(within(wechat).getByText(/Official Account/)).toBeOnTheScreen();
  });

  it('opens the chat app to start linking', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue();
    await renderView();

    await userEvent.press(await screen.findByRole('button', { name: 'Open Telegram' }));

    expect(open).toHaveBeenCalledWith('https://t.me/BiberBot');
  });

  it('unlinks only after the person confirms', async () => {
    let linked = true;
    const { mutation } = await renderView({
      links: async () =>
        linked ? [{ id: 'l1', platform: 'telegram', platformUsername: 'ada' }] : [],
      mutation: jest.fn(async () => {
        linked = false;
        return { success: true };
      }),
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    await userEvent.press(await screen.findByRole('button', { name: 'Unlink Telegram?' }));
    expect(alert).toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();

    alert.mockRestore();
    confirmAlerts();
    await userEvent.press(screen.getByRole('button', { name: 'Unlink Telegram?' }));

    expect(mutation).toHaveBeenCalledWith('messenger.unlink', { platform: 'telegram' });
    expect(
      await within(screen.getByTestId('chat-app-telegram')).findByText('Not linked'),
    ).toBeOnTheScreen();
  });

  it('says so when unlinking fails, and keeps the link', async () => {
    confirmAlerts();
    await renderView({
      links: [{ id: 'l1', platform: 'telegram', platformUsername: 'ada' }],
      mutation: jest.fn(async () => {
        throw new Error('offline');
      }),
    });

    await userEvent.press(await screen.findByRole('button', { name: 'Unlink Telegram?' }));

    expect(await screen.findByText('Could not unlink. Try again.')).toBeOnTheScreen();
    expect(screen.getByText('Linked as ada')).toBeOnTheScreen();
  });

  it('offers a retry when the chat apps cannot be loaded', async () => {
    await renderView({
      links: async () => {
        throw new Error('offline');
      },
    });

    expect(await screen.findByText('Could not load your chat apps.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });
});
