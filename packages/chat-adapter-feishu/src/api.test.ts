import { afterEach, describe, expect, it, vi } from 'vitest';

import { LarkApiClient } from './api';

const okJson = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, data }), {
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LarkApiClient with a tenant token provider (store apps)', () => {
  it("calls the API with the installing tenant's token, never the self-built app endpoint", async () => {
    const fetchMock = vi.fn(async () => okJson({ message_id: 'om_1' }));
    vi.stubGlobal('fetch', fetchMock);
    const tenantToken = vi.fn(async () => 't-tenant-a');

    const api = new LarkApiClient('cli_app', 'secret', 'lark', tenantToken);
    await api.sendMessageToUser('ou_alice', 'hello');

    expect(tenantToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=open_id');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t-tenant-a');
    expect(JSON.parse(init.body as string)).toMatchObject({ receive_id: 'ou_alice' });
  });

  it('reads the tenant name, and gives null when the app lacks the scope', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(okJson({ tenant: { name: 'Acme' } }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 99991672, msg: 'no permission' })),
        ),
    );
    const api = new LarkApiClient('cli_app', 'secret', 'lark', async () => 't');

    expect(await api.getTenantInfo()).toEqual({ name: 'Acme' });
    expect(await api.getTenantInfo()).toBeNull();
  });
});
