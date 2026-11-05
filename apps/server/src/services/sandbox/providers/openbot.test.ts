import { sha256 } from 'js-sha256';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';

import { clearOpenBotComputerCache, OpenBotSandboxProvider } from './openbot';

const env = vi.hoisted(() => ({ sandboxEnv: {} as Record<string, unknown> }));
vi.mock('@/envs/sandbox', () => env);

const options = {
  marketService: {} as MarketService,
  topicId: 'topic-1',
  userId: 'user-1',
};

const configured = {
  OPENBOT_COMPUTER_TOKEN: 'computer-token',
  OPENBOT_SUPERVISOR_TOKEN: 'supervisor-token',
  OPENBOT_SUPERVISOR_URL: 'http://supervisor.internal:4300/',
};

const shellResult = (overrides: Record<string, unknown> = {}) => ({
  command: 'echo ok',
  elapsedMs: 3,
  exitCode: 0,
  stderr: '',
  stdout: 'ok\n',
  timedOut: false,
  truncated: false,
  ...overrides,
});

const routeFetch = (exec: () => Response = () => Response.json(shellResult())) =>
  vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/ensure')) {
      return Response.json({ status: 'running', url: 'http://computer-1.internal:4100/' });
    }

    return exec();
  });

describe('OpenBotSandboxProvider', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    clearOpenBotComputerCache();
    env.sandboxEnv = configured;
  });

  it('refuses to run without the supervisor and computer credentials', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    env.sandboxEnv = {};

    const result = await new OpenBotSandboxProvider(options).callTool('runCommand', {
      command: 'echo ok',
    });

    expect(result).toMatchObject({ success: false });
    expect(result.error?.message).toContain('OPENBOT_SUPERVISOR_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the supervisor for the user computer once and runs commands on it', async () => {
    const fetchMock = routeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenBotSandboxProvider(options);

    const first = await provider.callTool('runCommand', { command: 'echo ok' });
    await provider.callTool('runCommand', { command: 'echo again' });

    const computerId = `u-${sha256('user-1').slice(0, 40)}`;
    expect(first).toMatchObject({ result: { exitCode: 0, stdout: 'ok\n' }, success: true });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `http://supervisor.internal:4300/computers/${computerId}/ensure`,
      'http://computer-1.internal:4100/exec',
      'http://computer-1.internal:4100/exec',
    ]);

    const [, ensureInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((ensureInit.headers as Headers).get('Authorization')).toBe('Bearer supervisor-token');

    const [, execInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const execHeaders = execInit.headers as Headers;
    expect(execHeaders.get('Authorization')).toBe('Bearer computer-token');
    expect(execHeaders.get('x-openbot-bot-id')).toBe(computerId);
    expect(JSON.parse(String(execInit.body))).toEqual({ command: 'echo ok', timeoutMs: 120_000 });
  });

  it('gives each topic its own computer when scoped by topic', async () => {
    const fetchMock = routeFetch();
    vi.stubGlobal('fetch', fetchMock);
    env.sandboxEnv = { ...configured, OPENBOT_COMPUTER_SCOPE: 'topic' };

    await new OpenBotSandboxProvider(options).callTool('runCommand', { command: 'pwd' });

    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://supervisor.internal:4300/computers/t-${sha256('user-1:topic-1').slice(0, 40)}/ensure`,
    );
  });

  it('reports a failing command as a completed tool call with its exit code', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch(() => Response.json(shellResult({ exitCode: 2, stderr: 'boom\n', stdout: '' }))),
    );

    const result = await new OpenBotSandboxProvider(options).callTool('runCommand', {
      command: 'false',
    });

    expect(result).toMatchObject({
      result: { exitCode: 2, stderr: 'boom\n', success: false },
      success: true,
    });
  });

  it('keeps timeouts inside the range the computer accepts', async () => {
    const fetchMock = routeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenBotSandboxProvider(options);

    await provider.callTool('runCommand', { command: 'a', timeout: 10 });
    await provider.callTool('runCommand', { command: 'b', timeout: 3_600_000 });

    const timeouts = fetchMock.mock.calls
      .filter(([url]) => url.endsWith('/exec'))
      .map(([, init]) => JSON.parse(String(init?.body)).timeoutMs);
    expect(timeouts).toEqual([1000, 600_000]);
  });

  it('turns a supervisor refusal into a tool error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Docker is not reachable.' }, { status: 503 })),
    );

    const result = await new OpenBotSandboxProvider(options).callTool('runCommand', {
      command: 'echo ok',
    });

    expect(result).toMatchObject({
      error: { message: 'Docker is not reachable.' },
      success: false,
    });
  });

  it('only reads background output for command ids it issued', async () => {
    const fetchMock = routeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenBotSandboxProvider(options);

    const read = await provider.callTool('getCommandOutput', { commandId: '../../etc/passwd' });
    const kill = await provider.callTool('killCommand', { commandId: '$(reboot)' });

    expect(read).toMatchObject({ error: { message: 'commandId is required' }, success: false });
    expect(kill).toMatchObject({ error: { message: 'commandId is required' }, success: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts background commands in their own session and returns their id', async () => {
    const fetchMock = routeFetch(() => Response.json(shellResult({ stdout: '' })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new OpenBotSandboxProvider(options).callTool('runCommand', {
      background: true,
      command: 'npm run dev',
    });

    expect(result.success).toBe(true);
    expect(result.result?.commandId).toMatch(/^bg-[\da-z-]+$/);
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).command).toContain('setsid nohup bash -c');
  });
});
