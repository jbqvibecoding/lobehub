// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => null,
}));

const config = { appId: 'cli_app', appSecret: 'app-secret' };

const reply = (body: Record<string, unknown>) => new Response(JSON.stringify({ code: 0, ...body }));

const loadTokens = async () => {
  vi.resetModules();
  return import('./tokens');
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const calledPaths = () =>
  fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname.split('/auth/v3')[1]);

describe('Lark store app tokens', () => {
  it('mints a tenant token from the app ticket, then reuses both tokens', async () => {
    const tokens = await loadTokens();
    fetchMock
      .mockResolvedValueOnce(reply({ app_access_token: 'a-1', expire: 7200 }))
      .mockResolvedValueOnce(reply({ expire: 7200, tenant_access_token: 't-a' }))
      .mockResolvedValueOnce(reply({ expire: 7200, tenant_access_token: 't-b' }));
    await tokens.saveLarkAppTicket('ticket-1');

    expect(await tokens.getLarkTenantAccessToken(config, 'tenant-a')).toBe('t-a');
    expect(await tokens.getLarkTenantAccessToken(config, 'tenant-a')).toBe('t-a');
    expect(await tokens.getLarkTenantAccessToken(config, 'tenant-b')).toBe('t-b');

    expect(calledPaths()).toEqual([
      '/app_access_token',
      '/tenant_access_token',
      '/tenant_access_token',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      app_id: 'cli_app',
      app_secret: 'app-secret',
      app_ticket: 'ticket-1',
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      app_access_token: 'a-1',
      tenant_key: 'tenant-b',
    });
  });

  it('asks Lark to resend the ticket when none has arrived yet', async () => {
    const tokens = await loadTokens();
    fetchMock.mockResolvedValueOnce(reply({}));

    await expect(tokens.getLarkTenantAccessToken(config, 'tenant-a')).rejects.toBeInstanceOf(
      tokens.LarkAppTicketMissingError,
    );
    expect(calledPaths()).toEqual(['/app_ticket/resend']);
  });

  it('drops an app token Lark rejects, so the next call mints a new one', async () => {
    const tokens = await loadTokens();
    fetchMock
      .mockResolvedValueOnce(reply({ app_access_token: 'a-stale', expire: 7200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 99991663, msg: 'invalid' })))
      .mockResolvedValueOnce(reply({ app_access_token: 'a-fresh', expire: 7200 }))
      .mockResolvedValueOnce(reply({ expire: 7200, tenant_access_token: 't-a' }));
    await tokens.saveLarkAppTicket('ticket-1');

    await expect(tokens.getLarkTenantAccessToken(config, 'tenant-a')).rejects.toThrow(/99991663/);
    expect(await tokens.getLarkTenantAccessToken(config, 'tenant-a')).toBe('t-a');
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).app_access_token).toBe('a-fresh');
  });
});
