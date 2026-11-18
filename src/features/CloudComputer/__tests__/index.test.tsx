import { ConfigProvider } from '@lobehub/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as m from 'motion/react-m';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CloudComputer from '../index';

const { service } = vi.hoisted(() => ({
  service: {
    handBack: vi.fn(),
    input: vi.fn(),
    start: vi.fn(),
    takeOver: vi.fn(),
    view: vi.fn(),
  },
}));

vi.mock('@/services/cloudComputer', () => ({ cloudComputerService: service }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options
        ? `${key}(${Object.entries(options)
            .map(([name, value]) => `${name}=${value}`)
            .join(',')})`
        : key,
  }),
}));

const picture = {
  base64: 'iVBORw0KGgo=',
  capturedAt: '2026-11-18T00:00:00Z',
  height: 800,
  url: 'https://example.com/login',
  width: 1280,
};

const running = (holder: 'bot' | 'human', extra: Record<string, unknown> = {}) => ({
  control: { helpRequested: false, holder, ...extra },
  screen: picture,
  status: 'running',
});

const renderPage = () =>
  render(
    <ConfigProvider motion={m}>
      <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
        <CloudComputer />
      </SWRConfig>
    </ConfigProvider>,
  );

describe('CloudComputer', () => {
  beforeEach(() => {
    // jsdom lays nothing out: the picture is drawn at half the page's size.
    vi.spyOn(HTMLImageElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 400,
      height: 400,
      left: 0,
      right: 640,
      top: 0,
      width: 640,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    service.input.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.values(service).forEach((fn) => fn.mockReset());
  });

  it('says when the deployment has no cloud computers', async () => {
    service.view.mockResolvedValue({ status: 'unavailable' });
    renderPage();

    expect(await screen.findByText('cloudComputer.unavailable')).toBeInTheDocument();
  });

  it('starts a computer that is off only when asked', async () => {
    service.view.mockResolvedValue({ status: 'off' });
    service.start.mockResolvedValue({ status: 'running' });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'cloudComputer.start' }));

    await waitFor(() => expect(service.start).toHaveBeenCalledTimes(1));
  });

  it('shows why the assistant asked for help, and sends nothing until the person takes over', async () => {
    service.view.mockResolvedValue(
      running('bot', { helpRequested: true, reason: 'Solve the captcha' }),
    );
    service.takeOver.mockResolvedValue(running('human'));
    renderPage();

    expect(
      await screen.findByText('cloudComputer.status.help(reason=Solve the captcha)'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('application', { name: 'cloudComputer.screenLabel' }));
    fireEvent.keyDown(screen.getByRole('application'), { key: 'a' });
    expect(service.input).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'cloudComputer.takeOver' }));
    await waitFor(() => expect(service.takeOver).toHaveBeenCalledTimes(1));
  });

  it('sends clicks at page coordinates, and keys, while the person holds it', async () => {
    service.view.mockResolvedValue(running('human'));
    renderPage();

    const frame = await screen.findByRole('application', { name: 'cloudComputer.screenLabel' });
    fireEvent.click(frame, { clientX: 320, clientY: 100 });
    fireEvent.keyDown(frame, { key: 'h' });
    fireEvent.keyDown(frame, { key: 'Enter' });

    await waitFor(() => expect(service.input).toHaveBeenCalledTimes(3));
    expect(service.input.mock.calls.map(([action]) => action)).toEqual([
      { kind: 'click', x: 640, y: 200 },
      { kind: 'type', text: 'h' },
      { key: 'Enter', kind: 'key' },
    ]);
  });

  it('hands the browser back', async () => {
    service.view.mockResolvedValue(running('human'));
    service.handBack.mockResolvedValue(running('bot'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'cloudComputer.handBack' }));

    await waitFor(() => expect(service.handBack).toHaveBeenCalledTimes(1));
  });

  it('shows the computer refusing an action', async () => {
    service.view.mockResolvedValue(running('bot'));
    service.takeOver.mockRejectedValue(new Error('That request is no longer waiting'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'cloudComputer.takeOver' }));

    expect(
      await screen.findByText(
        'cloudComputer.actionError(message=That request is no longer waiting)',
      ),
    ).toBeInTheDocument();
  });
});
