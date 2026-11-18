import { sha256 } from 'js-sha256';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearOpenBotComputerCache,
  computerTokenFor,
} from '@/server/services/sandbox/providers/openbotComputer';

import { CloudComputerService } from '../index';

const env = vi.hoisted(() => ({ sandboxEnv: {} as Record<string, unknown> }));
vi.mock('@/envs/sandbox', () => env);
vi.mock('@/envs/region', () => ({ regionEnv: { APP_REGION: 'global' } }));

const configured = {
  OPENBOT_COMPUTER_TOKEN: 'computer-token',
  OPENBOT_SUPERVISOR_TOKEN: 'supervisor-token',
  OPENBOT_SUPERVISOR_URL: 'http://supervisor.internal:4300',
  SANDBOX_PROVIDER: 'openbot',
};

const computerIdOf = (userId: string) => `u-${sha256(userId).slice(0, 40)}`;

interface Call {
  body?: any;
  headers: Headers;
  method: string;
  path: string;
}

/** A supervisor and one computer, answering as agent-computer does. */
const fakeOpenBot = ({ running = true } = {}) => {
  const calls: Call[] = [];
  const control = {
    holder: 'bot' as 'bot' | 'human',
    request: undefined as undefined | { id: string; source: string; status: string },
    requested: false,
    reason: undefined as string | undefined,
  };
  const state = () => ({ ...control, transitioning: false });

  const fetchSpy = vi.fn(async (url: string, init: RequestInit = {}) => {
    const { hostname, pathname } = new URL(url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      body,
      headers: new Headers(init.headers),
      method: init.method ?? 'GET',
      path: `${hostname}${pathname}`,
    });

    if (hostname === 'supervisor.internal') {
      if (pathname.endsWith('/ensure')) {
        running = true;
        return Response.json({ status: 'running', url: 'http://computer.internal:4100' });
      }
      return Response.json(
        running
          ? { status: 'running', url: 'http://computer.internal:4100' }
          : { status: 'exited' },
      );
    }

    switch (pathname) {
      case '/egress-policy': {
        return Response.json({ policy: body.policy });
      }
      case '/control': {
        return Response.json(state());
      }
      case '/screenshot': {
        return Response.json({
          base64: 'iVBORw0KGgo=',
          capturedAt: '2026-11-18T00:00:00Z',
          height: 800,
          url: 'https://example.com/login',
          width: 1280,
        });
      }
      case '/control/request': {
        if (!control.request) {
          control.request = { id: 'req-1', source: body.source ?? 'model', status: 'waiting' };
          control.requested = true;
          control.reason = body.reason;
        }
        return Response.json(state());
      }
      case '/control/take': {
        control.holder = 'human';
        control.requested = false;
        control.request = { ...control.request!, status: 'taken' };
        return Response.json(state());
      }
      case '/control/release': {
        control.holder = 'bot';
        control.request = { ...control.request!, status: 'completed' };
        return Response.json(state());
      }
      default: {
        if (pathname.startsWith('/human/')) {
          if (control.holder !== 'human') {
            return Response.json({ error: 'Take control first.' }, { status: 409 });
          }
          return Response.json({ action: pathname });
        }
        return Response.json({ error: 'not found' }, { status: 404 });
      }
    }
  });

  vi.stubGlobal('fetch', fetchSpy);
  return {
    askForHelp: (reason: string) => {
      control.request = { id: 'req-bot', source: 'model', status: 'waiting' };
      control.requested = true;
      control.reason = reason;
    },
    calls,
    computerCalls: () => calls.filter((call) => call.path.startsWith('computer.internal')),
  };
};

describe('CloudComputerService', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    clearOpenBotComputerCache();
    env.sandboxEnv = configured;
  });

  it('says so when the deployment runs no cloud computers', async () => {
    env.sandboxEnv = { ...configured, SANDBOX_PROVIDER: 'onlyboxes' };
    const openbot = fakeOpenBot();

    await expect(new CloudComputerService('user-1').view()).resolves.toEqual({
      status: 'unavailable',
    });
    expect(openbot.calls).toHaveLength(0);
  });

  it('shows a stopped computer as off, without starting it', async () => {
    const openbot = fakeOpenBot({ running: false });

    await expect(new CloudComputerService('user-1').view()).resolves.toEqual({ status: 'off' });

    expect(openbot.calls.map((call) => call.path)).toEqual([
      `supervisor.internal/computers/${computerIdOf('user-1')}`,
    ]);
    expect(openbot.calls[0].method).toBe('GET');
  });

  it("shows the user's own computer: who holds it and what is on screen", async () => {
    const openbot = fakeOpenBot();
    openbot.askForHelp('Solve the captcha on the login page');

    const view = await new CloudComputerService('user-1').view();

    expect(view).toMatchObject({
      control: {
        helpRequested: true,
        holder: 'bot',
        reason: 'Solve the captcha on the login page',
      },
      screen: { height: 800, url: 'https://example.com/login', width: 1280 },
      status: 'running',
    });
    for (const call of openbot.computerCalls()) {
      expect(call.headers.get('x-openbot-bot-id')).toBe(computerIdOf('user-1'));
      expect(call.headers.get('authorization')).toBe(
        `Bearer ${computerTokenFor('computer-token', computerIdOf('user-1'))}`,
      );
    }
  });

  it('gives a computer its network policy before using it: the public internet only', async () => {
    const openbot = fakeOpenBot();

    await new CloudComputerService('user-1').view();

    const pushed = openbot.calls.find((call) => call.path.endsWith('/egress-policy'));
    expect(pushed?.method).toBe('PUT');
    expect(pushed?.body.policy.mode).toBe('allowlist_only');
    const ranges = pushed?.body.policy.rules.map((rule: { value: string }) => rule.value);
    expect(ranges).toContain('8.0.0.0/7');
    expect(ranges).not.toContain('10.0.0.0/8');
    // Pushed once, then the address is reused.
    await new CloudComputerService('user-1').view();
    expect(openbot.calls.filter((call) => call.path.endsWith('/egress-policy'))).toHaveLength(1);
  });

  it('starts the computer only when asked to', async () => {
    const openbot = fakeOpenBot({ running: false });

    await expect(new CloudComputerService('user-1').start()).resolves.toMatchObject({
      status: 'running',
    });
    expect(openbot.calls[0].path).toBe(
      `supervisor.internal/computers/${computerIdOf('user-1')}/ensure`,
    );
  });

  it('takes over unasked by raising a request in the person’s name, then hands back', async () => {
    const openbot = fakeOpenBot();
    const computer = new CloudComputerService('user-1');

    const taken = await computer.takeOver();
    expect(taken.control).toMatchObject({ helpRequested: false, holder: 'human' });
    const asked = openbot.calls.find((call) => call.path.endsWith('/control/request'));
    expect(asked?.body).toMatchObject({ source: 'manual' });
    expect(openbot.calls.find((call) => call.path.endsWith('/control/take'))?.body).toEqual({
      requestId: 'req-1',
    });

    const back = await computer.handBack();
    expect(back.control?.holder).toBe('bot');
    expect(openbot.calls.find((call) => call.path.endsWith('/control/release'))?.body).toEqual({
      requestId: 'req-1',
    });
  });

  it('answers the assistant’s own request for help when it asked first', async () => {
    const openbot = fakeOpenBot();
    openbot.askForHelp('Sign in to the bank');

    await new CloudComputerService('user-1').takeOver();

    expect(openbot.calls.find((call) => call.path.endsWith('/control/take'))?.body).toEqual({
      requestId: 'req-bot',
    });
  });

  it('passes clicks and typing on only while the person holds the browser', async () => {
    const openbot = fakeOpenBot();
    const computer = new CloudComputerService('user-1');

    await expect(computer.input({ kind: 'click', x: 10, y: 20 })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Take control first.',
    });

    await computer.takeOver();
    await computer.input({ kind: 'click', x: 10, y: 20 });
    await computer.input({ kind: 'type', text: 'hunter2' });

    const human = openbot.calls.filter((call) => call.path.includes('/human/'));
    expect(human.map((call) => [call.path, call.body])).toEqual([
      ['computer.internal/human/click', { x: 10, y: 20 }],
      ['computer.internal/human/click', { x: 10, y: 20 }],
      ['computer.internal/human/type', { text: 'hunter2' }],
    ]);
  });

  it('cannot act on a computer that is not running', async () => {
    fakeOpenBot({ running: false });

    await expect(new CloudComputerService('user-1').takeOver()).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
