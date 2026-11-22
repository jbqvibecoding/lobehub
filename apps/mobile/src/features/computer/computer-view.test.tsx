import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { ApiClient } from '@/lib/api-client';

import { CloudComputerView } from './computer-view';
import type { ComputerView } from './types';

const picture = {
  base64: 'iVBORw0KGgo=',
  height: 800,
  url: 'https://example.com/login',
  width: 1280,
};

const running = (
  holder: 'bot' | 'human',
  extra: Partial<NonNullable<ComputerView['control']>> = {},
): ComputerView => ({
  control: { helpRequested: false, holder, ...extra },
  screen: picture,
  status: 'running',
});

const renderView = async ({
  mutation = jest.fn(async () => ({ ok: true })),
  view,
}: {
  mutation?: jest.Mock;
  view: ComputerView | (() => Promise<ComputerView>);
}) => {
  const query = jest.fn(typeof view === 'function' ? view : async () => view);
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
      <CloudComputerView api={{ mutation, query } as unknown as ApiClient} />
    </QueryClientProvider>,
  );
  return { mutation, query };
};

/** The picture is laid out at a quarter of the page's width. */
const layOut = async () => {
  const frame = await screen.findByTestId('computer-screen');
  await fireEvent(frame, 'layout', { nativeEvent: { layout: { height: 200, width: 320 } } });
  return frame;
};

describe('CloudComputerView', () => {
  it('starts a computer that is off only when asked', async () => {
    const { mutation } = await renderView({ view: { status: 'off' } });

    expect(mutation).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByRole('button', { name: 'Start' }));

    expect(mutation).toHaveBeenCalledWith('computer.start');
  });

  it('shows why Biber asked for help, and does not pass taps on before taking over', async () => {
    const { mutation } = await renderView({
      view: running('bot', { helpRequested: true, reason: 'Solve the captcha' }),
    });

    expect(await screen.findByText('Solve the captcha')).toBeOnTheScreen();
    const frame = await layOut();
    await fireEvent.press(frame, { nativeEvent: { locationX: 100, locationY: 50 } });
    expect(mutation).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Take over' }));
    expect(mutation).toHaveBeenCalledWith('computer.takeOver');
  });

  it('taps the page at page coordinates and types text while the person holds it', async () => {
    const { mutation } = await renderView({ view: running('human') });

    const frame = await layOut();
    await fireEvent.press(frame, { nativeEvent: { locationX: 100, locationY: 50 } });
    await fireEvent.changeText(screen.getByLabelText('Text to type into the page'), 'hunter2');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Enter' }));

    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(3));
    expect(mutation.mock.calls).toEqual([
      ['computer.input', { action: { kind: 'click', x: 400, y: 200 } }],
      ['computer.input', { action: { kind: 'type', text: 'hunter2' } }],
      ['computer.input', { action: { key: 'Enter', kind: 'key' } }],
    ]);
  });

  it('takes the value Biber asked for in a masked box, without taking over', async () => {
    let wanted = true;
    const mutation = jest.fn(async () => {
      wanted = false;
      return { supplied: true };
    });
    await renderView({
      mutation,
      view: async () => running('bot', wanted ? { secretWanted: 'the 6-digit code' } : {}),
    });

    const box = await screen.findByLabelText('the 6-digit code');
    expect(box).toHaveProp('secureTextEntry', true);
    await fireEvent.changeText(box, '482913');
    await fireEvent.press(screen.getByRole('button', { name: 'Fill in' }));

    expect(mutation).toHaveBeenCalledWith('computer.supplySecret', { text: '482913' });
    await waitFor(() => expect(screen.queryByLabelText('the 6-digit code')).not.toBeOnTheScreen());
  });

  it('hands the browser back', async () => {
    const { mutation } = await renderView({ view: running('human') });

    await fireEvent.press(await screen.findByRole('button', { name: 'Hand back to Biber' }));

    expect(mutation).toHaveBeenCalledWith('computer.handBack');
  });

  it('says so when the computer refuses', async () => {
    await renderView({
      mutation: jest.fn(async () => {
        throw new Error('That request is no longer waiting');
      }),
      view: running('bot'),
    });

    await fireEvent.press(await screen.findByRole('button', { name: 'Take over' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That did not work. Try again.');
  });

  it('says when the service has no cloud computers', async () => {
    await renderView({ view: { status: 'unavailable' } });

    expect(await screen.findByText('This service has no cloud computers.')).toBeOnTheScreen();
  });
});
