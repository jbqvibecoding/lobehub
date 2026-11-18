import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { ApiClient } from '@/lib/api-client';

import { MemoriesList } from './memories';
import type { Memory, MemoryExtraction, MemoryPage } from './types';

const memory = (id: string, title: string, layer = 'preference'): Memory => ({
  capturedAt: new Date('2026-03-02T08:00:00Z'),
  id,
  layer,
  summary: `${title}, remembered from a chat`,
  title,
});

const extraction = (overrides: Partial<MemoryExtraction> = {}): MemoryExtraction => ({
  added: 2,
  changed: 1,
  createdAt: new Date('2026-11-18T08:00:00Z'),
  id: 'x1',
  topicTitle: 'Moving house',
  ...overrides,
});

const renderList = async ({
  extractions = async () => [],
  mutation = jest.fn(async () => ({ forgotten: true })),
  pages,
}: {
  extractions?: () => Promise<MemoryExtraction[]>;
  mutation?: jest.Mock;
  pages: () => Promise<MemoryPage>;
}) => {
  const query = jest.fn((path: string) =>
    path === 'memories.recentExtractions' ? extractions() : pages(),
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
      <MemoriesList api={{ mutation, query } as unknown as ApiClient} />
    </QueryClientProvider>,
  );
  return { mutation, query };
};

const confirmAlerts = () =>
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    buttons?.find((button) => button.style === 'destructive')?.onPress?.();
  });

afterEach(() => jest.restoreAllMocks());

describe('MemoriesList', () => {
  it('shows what Biber remembers, with what kind of memory it is', async () => {
    await renderList({
      pages: async () => ({ hasMore: false, items: [memory('m1', 'Window seats')] }),
    });

    expect(await screen.findByText('Window seats')).toBeOnTheScreen();
    expect(screen.getByText(/^Preference · /)).toBeOnTheScreen();
  });

  it('says when there is nothing yet', async () => {
    await renderList({ pages: async () => ({ hasMore: false, items: [] }) });

    expect(await screen.findByText(/Nothing yet/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Forget everything' })).not.toBeOnTheScreen();
  });

  it('forgets one memory after the person confirms', async () => {
    let items = [memory('m1', 'Window seats'), memory('m2', 'Lives in Berlin', 'identity')];
    const { mutation } = await renderList({
      mutation: jest.fn(async (_path: string, input: { id: string }) => {
        items = items.filter((item) => item.id !== input.id);
        return { forgotten: true };
      }),
      pages: async () => ({ hasMore: false, items }),
    });
    confirmAlerts();

    await userEvent.press(await screen.findByRole('button', { name: 'Forget: Window seats' }));

    expect(mutation).toHaveBeenCalledWith('memories.forget', { id: 'm1' });
    expect(await screen.findByText('Lives in Berlin')).toBeOnTheScreen();
    expect(screen.queryByText('Window seats')).not.toBeOnTheScreen();
  });

  it('keeps the memory and says so when forgetting fails', async () => {
    confirmAlerts();
    await renderList({
      mutation: jest.fn(async () => {
        throw new Error('offline');
      }),
      pages: async () => ({ hasMore: false, items: [memory('m1', 'Window seats')] }),
    });

    await userEvent.press(await screen.findByRole('button', { name: 'Forget: Window seats' }));

    expect(await screen.findByText('Could not forget it. Try again.')).toBeOnTheScreen();
    expect(screen.getByText('Window seats')).toBeOnTheScreen();
  });

  it('forgets everything only after the person confirms', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { mutation } = await renderList({
      pages: async () => ({ hasMore: false, items: [memory('m1', 'Window seats')] }),
    });

    await userEvent.press(await screen.findByRole('button', { name: 'Forget everything' }));
    expect(alert).toHaveBeenCalledWith(
      'Forget everything?',
      expect.stringContaining('cannot be undone'),
      expect.any(Array),
    );
    expect(mutation).not.toHaveBeenCalled();

    alert.mockRestore();
    confirmAlerts();
    await userEvent.press(screen.getByRole('button', { name: 'Forget everything' }));
    expect(mutation).toHaveBeenCalledWith('memories.forgetAll');
  });

  it('lists what recent chats taught, and undoes one after the person confirms', async () => {
    let recent = [extraction(), extraction({ added: 1, changed: 0, id: 'x2', topicTitle: null })];
    const { mutation } = await renderList({
      extractions: async () => recent,
      mutation: jest.fn(async () => {
        recent = recent.filter((item) => item.id !== 'x1');
        return { forgotten: 2, notRestored: [], restored: 1, undone: true };
      }),
      pages: async () => ({ hasMore: false, items: [memory('m1', 'Lives in Lisbon')] }),
    });

    expect(await screen.findByText('From “Moving house”')).toBeOnTheScreen();
    expect(screen.getByText(/^2 learned, 1 changed · /)).toBeOnTheScreen();
    expect(screen.getByText('From a chat')).toBeOnTheScreen();

    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await userEvent.press(screen.getByRole('button', { name: 'Undo: From “Moving house”' }));
    expect(alert).toHaveBeenCalledWith(
      'Undo what Biber learned here?',
      expect.stringContaining('will not learn from this chat again'),
      expect.any(Array),
    );
    expect(mutation).not.toHaveBeenCalled();

    alert.mockRestore();
    confirmAlerts();
    await userEvent.press(screen.getByRole('button', { name: 'Undo: From “Moving house”' }));
    expect(mutation).toHaveBeenCalledWith('memories.undoExtraction', { id: 'x1' });
    expect(await screen.findByText('From a chat')).toBeOnTheScreen();
    expect(screen.queryByText('From “Moving house”')).not.toBeOnTheScreen();
  });

  it('says which memories were left as they are because they changed since', async () => {
    confirmAlerts();
    await renderList({
      extractions: async () => [extraction()],
      mutation: jest.fn(async () => ({
        forgotten: 2,
        notRestored: ['Lives in Porto'],
        restored: 0,
        undone: true,
      })),
      pages: async () => ({ hasMore: false, items: [] }),
    });

    await userEvent.press(await screen.findByRole('button', { name: 'Undo: From “Moving house”' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'These changed again since, so they stay as they are now: Lives in Porto',
    );
  });

  it('says so when undoing fails', async () => {
    confirmAlerts();
    await renderList({
      extractions: async () => [extraction()],
      mutation: jest.fn(async () => {
        throw new Error('offline');
      }),
      pages: async () => ({ hasMore: false, items: [] }),
    });

    await userEvent.press(await screen.findByRole('button', { name: 'Undo: From “Moving house”' }));

    expect(await screen.findByText('Could not undo it. Try again.')).toBeOnTheScreen();
    expect(screen.getByText('From “Moving house”')).toBeOnTheScreen();
  });

  it('offers a retry when the memories cannot be loaded', async () => {
    await renderList({
      pages: async () => {
        throw new Error('offline');
      },
    });

    expect(await screen.findByText('Could not load your memories.')).toBeOnTheScreen();
  });
});
