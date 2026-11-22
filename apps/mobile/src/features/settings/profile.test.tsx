import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { render, screen, userEvent, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { ApiClient } from '@/lib/api-client';

import { AboutYouView, ProfileInvite } from './profile';
import type { Profile } from './types';

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-US' }],
}));

const failure = (message: string) =>
  TRPCClientError.from({
    error: { code: -32_000, data: { code: 'BAD_REQUEST' }, message },
  } as never);

const profile = (overrides: Partial<Profile> = {}): Profile => ({
  entries: [
    { id: 'name', section: 'name', text: 'An', updatedAt: '2026-11-01T08:00:00.000Z' },
    {
      id: 'G0',
      reviewedAt: '2026-11-20T08:00:00.000Z',
      section: 'goals',
      text: 'Run a marathon before October',
      updatedAt: '2026-11-01T08:00:00.000Z',
    },
  ],
  interview: { startedAt: '2026-11-01T08:00:00.000Z', topicId: 'topic-interview' },
  ...overrides,
});

const wrap = (ui: React.ReactElement) => (
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
    {ui}
  </QueryClientProvider>
);

const renderAboutYou = async ({
  data = () => profile(),
  mutation = jest.fn(async () => ({})),
}: { data?: () => Profile; mutation?: jest.Mock } = {}) => {
  const query = jest.fn(async () => data());
  const onOpenInterview = jest.fn();
  await render(
    wrap(
      <AboutYouView
        api={{ mutation, query } as unknown as ApiClient}
        onOpenInterview={onOpenInterview}
      />,
    ),
  );
  return { mutation, onOpenInterview, query };
};

afterEach(() => jest.restoreAllMocks());

describe('AboutYouView', () => {
  it('lists entries by section with their number and when they were last true', async () => {
    await renderAboutYou();

    expect(await screen.findByRole('heading', { name: 'What to call you' })).toBeOnTheScreen();
    expect(screen.getByRole('heading', { name: 'Goals' })).toBeOnTheScreen();
    const goal = screen.getByTestId('entry-G0');
    expect(within(goal).getByText('Run a marathon before October')).toBeOnTheScreen();
    expect(within(goal).getByText(/G0 · updated/)).toBeOnTheScreen();
    expect(screen.queryByRole('heading', { name: 'Mission' })).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue the interview' })).toBeOnTheScreen();
  });

  it('changes an entry, keeping its number', async () => {
    const user = userEvent.setup();
    const { mutation } = await renderAboutYou();

    await user.press(await screen.findByRole('button', { name: 'Edit G0' }));
    const input = screen.getByLabelText('Edit G0');
    await user.clear(input);
    await user.type(input, 'Before November');
    await user.press(screen.getByRole('button', { name: 'Save' }));

    expect(mutation).toHaveBeenCalledWith('profile.saveEntry', {
      id: 'G0',
      section: 'goals',
      text: 'Before November',
    });
  });

  it('keeps what was typed and says why when a change is refused', async () => {
    const user = userEvent.setup();
    const mutation = jest.fn(async () => {
      throw failure('PROFILE_SECRET');
    });
    await renderAboutYou({ mutation });

    await user.press(await screen.findByRole('button', { name: 'Edit name' }));
    const input = screen.getByLabelText('Edit name');
    await user.clear(input);
    await user.type(input, 'pin 4111111111111111');
    await user.press(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This looks like a password, key or card number. Those are never kept here.',
    );
    expect(screen.getByLabelText('Edit name')).toHaveDisplayValue('pin 4111111111111111');
  });

  it('deletes an entry only after the user confirms', async () => {
    const user = userEvent.setup();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { mutation } = await renderAboutYou();

    await user.press(await screen.findByRole('button', { name: 'Delete G0?' }));
    expect(alert).toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();

    alert.mockImplementation((_title, _body, buttons) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.();
    });
    await user.press(screen.getByRole('button', { name: 'Delete G0?' }));
    expect(mutation).toHaveBeenCalledWith('profile.dropEntry', { id: 'G0' });
  });

  it('clears everything only after the user confirms', async () => {
    const user = userEvent.setup();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((title, _body, buttons) => {
      if (title === 'Clear everything about you?') {
        buttons?.find((button) => button.style === 'destructive')?.onPress?.();
      }
    });
    const { mutation } = await renderAboutYou();

    await user.press(await screen.findByRole('button', { name: 'Clear everything' }));

    expect(alert).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith('profile.clear');
  });

  it('starts the interview for someone Biber does not know yet, and opens it', async () => {
    const user = userEvent.setup();
    const mutation = jest.fn(async () => ({ operationId: 'op-1', topicId: 'topic-new' }));
    const { onOpenInterview } = await renderAboutYou({
      data: () => profile({ entries: [], interview: {} }),
      mutation,
    });

    expect(await screen.findByText(/doesn't know anything about you yet/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Start the interview' }));

    expect(mutation).toHaveBeenCalledWith('profile.startInterview', { locale: 'en-US' });
    expect(onOpenInterview).toHaveBeenCalledWith('topic-new');
    expect(screen.queryByRole('button', { name: 'Clear everything' })).not.toBeOnTheScreen();
  });
});

describe('ProfileInvite', () => {
  const renderInvite = async (invite: boolean, mutation = jest.fn(async () => ({}))) => {
    const query = jest.fn(async () => ({ invite }));
    const onOpenInterview = jest.fn();
    await render(
      wrap(
        <ProfileInvite
          api={{ mutation, query } as unknown as ApiClient}
          onOpenInterview={onOpenInterview}
        />,
      ),
    );
    return { mutation, onOpenInterview, query };
  };

  it('invites someone Biber knows nothing about, and opens the interview', async () => {
    const user = userEvent.setup();
    const { mutation, onOpenInterview } = await renderInvite(
      true,
      jest.fn(async () => ({ operationId: 'op-1', topicId: 'topic-1' })),
    );

    expect(
      await screen.findByRole('heading', { name: 'Let Biber get to know you' }),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Start' }));

    expect(mutation).toHaveBeenCalledWith('profile.startInterview', { locale: 'en-US' });
    expect(onOpenInterview).toHaveBeenCalledWith('topic-1');
  });

  it('goes away for good on "Later"', async () => {
    const user = userEvent.setup();
    const { mutation } = await renderInvite(true);

    await user.press(await screen.findByRole('button', { name: 'Later' }));

    expect(mutation).toHaveBeenCalledWith('profile.dismissInvite');
    expect(screen.queryByTestId('profile-invite')).not.toBeOnTheScreen();
  });

  it('shows nothing when there is nothing to invite to', async () => {
    const { query } = await renderInvite(false);

    expect(query).toHaveBeenCalledWith('profile.status');
    expect(screen.queryByTestId('profile-invite')).not.toBeOnTheScreen();
  });

  it('keeps the invite and says so when the interview could not be opened', async () => {
    const user = userEvent.setup();
    const { onOpenInterview } = await renderInvite(
      true,
      jest.fn(async () => {
        throw new Error('offline');
      }),
    );

    await user.press(await screen.findByRole('button', { name: 'Start' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't do that. Try again.");
    expect(onOpenInterview).not.toHaveBeenCalled();
    expect(screen.getByTestId('profile-invite')).toBeOnTheScreen();
  });
});
