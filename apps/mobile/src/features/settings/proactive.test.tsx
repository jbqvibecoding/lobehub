import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';

import type { ApiClient } from '@/lib/api-client';

import { ProactiveSettingsView } from './proactive';
import type { ProactiveSettings, ProactiveThought } from './types';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const defaults: ProactiveSettings = {
  cooldownUntil: null,
  level: 'standard',
  quietEnd: 8,
  quietStart: 22,
  timeZone: 'Asia/Shanghai',
};

const dentist: ProactiveThought = {
  expiresAt: null,
  id: 'thought-1',
  kind: 'reminder',
  occursAt: new Date('2026-11-21T02:00:00Z'),
  seed: 'Dentist at 10',
};

const renderView = async ({
  mutation = jest.fn(async (_path: string, input: Partial<ProactiveSettings>) => ({
    ...defaults,
    ...input,
  })),
  settings = async () => defaults,
  thoughts = async () => [dentist],
}: {
  mutation?: jest.Mock;
  settings?: () => Promise<ProactiveSettings>;
  thoughts?: () => Promise<ProactiveThought[]>;
} = {}) => {
  const query = jest.fn((path: string) =>
    path === 'proactive.getSettings' ? settings() : thoughts(),
  );
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
      <ProactiveSettingsView api={{ mutation, query } as unknown as ApiClient} />
    </QueryClientProvider>,
  );
  return { mutation, query };
};

describe('ProactiveSettingsView', () => {
  it('shows the level, the quiet hours, and what Biber means to bring up', async () => {
    await renderView();

    expect(
      await screen.findByRole('radio', {
        checked: true,
        name: 'Reminders and follow-ups, up to three a day',
      }),
    ).toBeOnTheScreen();
    expect(screen.getByText('22:00')).toBeOnTheScreen();
    expect(screen.getByText('08:00')).toBeOnTheScreen();
    expect(await screen.findByText('Dentist at 10')).toBeOnTheScreen();
    expect(screen.getByText(/^Reminder · /)).toBeOnTheScreen();
  });

  it('saves a new level and moves quiet hours by an hour', async () => {
    const { mutation } = await renderView();
    const user = userEvent.setup();

    await user.press(await screen.findByRole('radio', { name: 'Never' }));
    expect(mutation).toHaveBeenCalledWith('proactive.updateSettings', { level: 'off' });
    expect(await screen.findByRole('radio', { checked: true, name: 'Never' })).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'From: One hour later' }));
    expect(mutation).toHaveBeenCalledWith('proactive.updateSettings', { quietStart: 23 });
  });

  it('pauses for seven days and resumes', async () => {
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const mutation = jest.fn(async (_path: string, input: { quietForDays?: number | null }) => ({
      ...defaults,
      cooldownUntil: input.quietForDays ? until : null,
    }));
    await renderView({ mutation });
    const user = userEvent.setup();

    await user.press(await screen.findByRole('button', { name: 'Quiet for 7 days' }));
    expect(mutation).toHaveBeenCalledWith('proactive.updateSettings', { quietForDays: 7 });

    await user.press(await screen.findByRole('button', { name: 'Resume' }));
    expect(mutation).toHaveBeenCalledWith('proactive.updateSettings', { quietForDays: null });
    expect(await screen.findByRole('button', { name: 'Quiet for 7 days' })).toBeOnTheScreen();
  });

  it('takes a thought off the list', async () => {
    let remaining = [dentist];
    const mutation = jest.fn(async () => {
      remaining = [];
      return { dropped: true };
    });
    await renderView({ mutation, thoughts: async () => remaining });

    await userEvent.press(
      await screen.findByRole('button', { name: "Don't bring this up: Dentist at 10" }),
    );

    expect(mutation).toHaveBeenCalledWith('proactive.dropThought', { id: 'thought-1' });
    expect(await screen.findByText(/^Nothing yet\./)).toBeOnTheScreen();
  });

  it('says when the settings do not load', async () => {
    await renderView({ settings: async () => Promise.reject(new Error('offline')) });
    expect(await screen.findByText('Could not load these settings.')).toBeOnTheScreen();
  });

  it('keeps the current level and says so when a save fails', async () => {
    await renderView({ mutation: jest.fn(async () => Promise.reject(new Error('offline'))) });

    await userEvent.press(await screen.findByRole('radio', { name: 'Never' }));

    expect(await screen.findByText('That did not save. Try again.')).toBeOnTheScreen();
    expect(
      screen.getByRole('radio', {
        checked: true,
        name: 'Reminders and follow-ups, up to three a day',
      }),
    ).toBeOnTheScreen();
  });
});
