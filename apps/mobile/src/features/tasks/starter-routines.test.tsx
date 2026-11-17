import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ApiClient } from '@/lib/api-client';

import { StarterRoutines } from './starter-routines';

jest.mock('expo-localization', () => ({
  getCalendars: () => [{ timeZone: 'Asia/Shanghai' }],
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-US' }],
}));

const routines = [
  {
    description: 'Every day at 7:30.',
    enabled: false,
    id: 'morning-brief',
    name: 'Morning brief',
  },
  {
    description: 'Fridays at 17:00.',
    enabled: true,
    id: 'weekly-review',
    name: 'Weekly review',
  },
];

const renderRoutines = async ({
  mutation = jest.fn(async () => ({ taskId: 'task-1' })),
  query = jest.fn(async () => routines),
}: { mutation?: jest.Mock; query?: jest.Mock } = {}) => {
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
      <StarterRoutines api={{ mutation, query } as unknown as ApiClient} />
    </QueryClientProvider>,
  );
  return { mutation, query };
};

describe('StarterRoutines', () => {
  it('lists the routines in the phone language with whether each is on', async () => {
    const { query } = await renderRoutines();

    expect(await screen.findByRole('heading', { name: 'Routines' })).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: 'Morning brief' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Weekly review' })).toBeChecked();
    expect(query).toHaveBeenCalledWith('routines.list', { locale: 'en-US' });
  });

  it('turns a routine on in the phone time zone, and off again', async () => {
    const { mutation } = await renderRoutines();

    await fireEvent(
      await screen.findByRole('switch', { name: 'Morning brief' }),
      'valueChange',
      true,
    );
    expect(mutation).toHaveBeenCalledWith('routines.enable', {
      id: 'morning-brief',
      locale: 'en-US',
      timeZone: 'Asia/Shanghai',
    });

    await fireEvent(screen.getByRole('switch', { name: 'Weekly review' }), 'valueChange', false);
    expect(mutation).toHaveBeenCalledWith('routines.disable', { id: 'weekly-review' });
  });

  it('says so when a change does not go through', async () => {
    await renderRoutines({
      mutation: jest.fn(async () => {
        throw new Error('offline');
      }),
    });

    await fireEvent(
      await screen.findByRole('switch', { name: 'Morning brief' }),
      'valueChange',
      true,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('That did not change. Try again.');
  });

  it('stays out of the way when the routines cannot load', async () => {
    await renderRoutines({
      query: jest.fn(async () => {
        throw new Error('offline');
      }),
    });

    expect(screen.queryByRole('heading', { name: 'Routines' })).not.toBeOnTheScreen();
  });
});
