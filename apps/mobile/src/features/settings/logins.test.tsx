import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { render, screen, userEvent, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { ApiClient } from '@/lib/api-client';

import { SavedLoginsView } from './logins';
import type { SavedLogin } from './types';

const shop: SavedLogin = {
  account: 'a•••@qq.com',
  id: 'login-1',
  label: 'shop.example',
  lastUsedAt: null,
  site: 'https://shop.example',
};

const failure = (message: string) =>
  TRPCClientError.from({
    error: { code: -32_000, data: { code: 'BAD_REQUEST' }, message },
  } as never);

const renderView = async ({
  logins,
  mutation = jest.fn(async () => ({})),
}: {
  logins: () => SavedLogin[];
  mutation?: jest.Mock;
}) => {
  const query = jest.fn(async () => logins());
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
      <SavedLoginsView api={{ mutation, query } as unknown as ApiClient} />
    </QueryClientProvider>,
  );
  return { mutation, query };
};

afterEach(() => jest.restoreAllMocks());

describe('SavedLoginsView', () => {
  it('lists the logins by site and account, never a password', async () => {
    await renderView({ logins: () => [shop] });

    const card = await screen.findByTestId('login-login-1');
    expect(within(card).getByText('https://shop.example')).toBeOnTheScreen();
    expect(within(card).getByText('a•••@qq.com')).toBeOnTheScreen();
  });

  it('adds a login with a masked password', async () => {
    let saved: SavedLogin[] = [];
    const mutation = jest.fn(async () => {
      saved = [shop];
      return shop;
    });
    await renderView({ logins: () => saved, mutation });

    expect(await screen.findByText('No saved logins yet.')).toBeOnTheScreen();
    await userEvent.press(screen.getByRole('button', { name: 'Add a login' }));
    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Website'), 'shop.example');
    await userEvent.type(screen.getByLabelText('User name or email'), 'ada@qq.com');
    await userEvent.type(screen.getByLabelText('Password'), 'Hunter2-secret');
    await userEvent.press(screen.getByRole('button', { name: 'Save' }));

    expect(mutation).toHaveBeenCalledWith('logins.create', {
      password: 'Hunter2-secret',
      site: 'shop.example',
      username: 'ada@qq.com',
    });
    expect(await screen.findByTestId('login-login-1')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Password')).not.toBeOnTheScreen();
  });

  it('says why a site was refused and keeps what was typed', async () => {
    await renderView({
      logins: () => [],
      mutation: jest.fn(async () => {
        throw failure('LOGIN_SITE');
      }),
    });

    await userEvent.press(await screen.findByRole('button', { name: 'Add a login' }));
    await userEvent.type(screen.getByLabelText('Website'), 'http://shop.example');
    await userEvent.type(screen.getByLabelText('Password'), 'Hunter2-secret');
    await userEvent.press(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Only https sites can be saved/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Website')).toHaveDisplayValue('http://shop.example');
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('Hunter2-secret');
  });

  it('deletes a login only after the person confirms', async () => {
    const mutation = jest.fn(async () => ({ deleted: true }));
    await renderView({ logins: () => [shop], mutation });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    await userEvent.press(await screen.findByRole('button', { name: 'Delete shop.example?' }));
    expect(alert).toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();

    alert.mockImplementation((_title, _body, buttons) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.();
    });
    await userEvent.press(screen.getByRole('button', { name: 'Delete shop.example?' }));
    expect(mutation).toHaveBeenCalledWith('logins.delete', { id: 'login-1' });
  });
});
