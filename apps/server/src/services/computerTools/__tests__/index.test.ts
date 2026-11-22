import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearOpenBotComputerCache } from '@/server/services/sandbox/providers/openbotComputer';

import { ComputerToolsService, isCloudComputerAvailable } from '../index';

const env = vi.hoisted(() => ({ sandboxEnv: {} as Record<string, unknown> }));
vi.mock('@/envs/sandbox', () => env);
vi.mock('@/envs/region', () => ({ regionEnv: { APP_REGION: 'cn' } }));

/** The Redis-less cache, kept in memory per test. */
const cache = vi.hoisted(() => new Map<string, string>());
vi.mock('@/server/services/messenger/expiringCache', () => ({
  expiringCache: {
    del: async (key: string) => void cache.delete(key),
    get: async (key: string) => cache.get(key) ?? null,
    set: async (key: string, value: string) => void cache.set(key, value),
  },
}));

const pushes = vi.hoisted(() => ({ delivered: [] as any[], notifications: [] as any[] }));
vi.mock('@/database/models/notification', () => ({
  NotificationModel: class {
    create = async (row: any) => {
      pushes.notifications.push(row);
      return { id: `n-${pushes.notifications.length}` };
    };
  },
}));
vi.mock('@/server/services/push/PushChannel', () => ({
  PushChannel: class {
    deliver = async (message: any) => {
      pushes.delivered.push(message);
      return { status: 'sent' };
    };
  },
}));

const configured = {
  OPENBOT_COMPUTER_TOKEN: 'computer-token',
  OPENBOT_SUPERVISOR_TOKEN: 'supervisor-token',
  OPENBOT_SUPERVISOR_URL: 'http://supervisor.internal:4300',
  SANDBOX_PROVIDER: 'openbot',
};

const SHOP = [
  { name: 'Email', ref: 'e1', role: 'textbox', value: 'ada@example.com' },
  { name: 'Next page', ref: 'e2', role: 'button' },
  { name: 'Place order', ref: 'e3', role: 'button' },
  { name: 'Order history', ref: 'e4', role: 'link' },
];

/** A supervisor and one computer, answering as agent-computer does, on a shop's checkout page. */
const fakeComputer = (elements = SHOP) => {
  const calls: { body?: any; path: string }[] = [];
  let snapshotId = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const { hostname, pathname } = new URL(url);
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      if (hostname === 'supervisor.internal') {
        return Response.json({ status: 'running', url: 'http://computer.internal:4100' });
      }
      calls.push({ body, path: pathname });
      switch (pathname) {
        case '/egress-policy': {
          return Response.json({ ok: true });
        }
        case '/navigate': {
          snapshotId += 1;
          return Response.json({ text: 'Checkout', title: 'Shop', url: body.url });
        }
        case '/snapshot': {
          snapshotId += 1;
          return Response.json({
            elements,
            snapshotId,
            title: 'Checkout',
            truncated: false,
            url: 'https://shop.example/checkout?step=2',
          });
        }
        case '/control/request': {
          return Response.json({ request: { id: 'req-1' }, requested: true });
        }
        default: {
          return Response.json({ url: 'https://shop.example/checkout?step=2' });
        }
      }
    }),
  );
  return { actions: () => calls.filter((call) => !['/egress-policy'].includes(call.path)), calls };
};

const service = () => new ComputerToolsService({} as any, 'user-1');

beforeEach(() => {
  env.sandboxEnv = { ...configured };
  cache.clear();
  clearOpenBotComputerCache();
  pushes.delivered = [];
  pushes.notifications = [];
});

describe('ComputerToolsService', () => {
  it('lists the page with its site and refs, and marks what needs approval', async () => {
    fakeComputer();
    const result = await service().snapshot();

    expect(result.success).toBe(true);
    expect(result.content).toContain('Site: https://shop.example · snapshotId 1');
    expect(result.content).toContain('- e1 textbox "Email" = "ada@example.com"');
    expect(result.content).toMatch(/e3 button "Place order" · needs approval/);
    expect(result.content).not.toMatch(/e2 button "Next page" · needs approval/);
    expect(result.content).not.toMatch(/e4 link "Order history" · needs approval/);
    // What the server keeps holds the names, not what was typed into fields
    expect([...cache.values()].join()).not.toContain('ada@example.com');
  });

  it('clicks an ordinary button, and holds a paying one for approval', async () => {
    const computer = fakeComputer();
    const tools = service();
    await tools.snapshot();

    expect((await tools.click({ ref: 'e2', snapshotId: 1 })).success).toBe(true);
    const held = await tools.click({ ref: 'e3', snapshotId: 1 });

    expect(held).toMatchObject({ error: { type: 'ComputerNeedsApproval' }, success: false });
    expect(held.content).toContain('clickWithApproval');
    expect(held.content).toContain('element "Place order" and site "https://shop.example"');
    const clicks = computer.actions().filter((call) => call.path === '/click');
    expect(clicks).toEqual([{ body: { ref: 'e2', snapshotId: 1 }, path: '/click' }]);
  });

  it('clicks the approved button only when it is the one the page showed', async () => {
    const computer = fakeComputer();
    const tools = service();
    await tools.snapshot();
    const approve = (element: string, site: string) =>
      tools.clickWithApproval({ element, ref: 'e3', site, snapshotId: 1 });

    expect((await approve('Next page', 'https://shop.example')).error?.type).toBe(
      'ComputerMismatch',
    );
    expect((await approve('Place order', 'https://evil.example')).error?.type).toBe(
      'ComputerMismatch',
    );
    expect(computer.actions().some((call) => call.path === '/click')).toBe(false);

    expect((await approve('Place order', 'https://shop.example')).success).toBe(true);
    expect(computer.actions().filter((call) => call.path === '/click')).toHaveLength(1);
  });

  it('refuses refs from an old snapshot, and after the page changed', async () => {
    const computer = fakeComputer();
    const tools = service();

    expect((await tools.click({ ref: 'e2', snapshotId: 1 })).error?.type).toBe(
      'ComputerStaleSnapshot',
    );
    await tools.snapshot();
    await tools.navigate({ url: 'https://shop.example/cart' });
    expect((await tools.click({ ref: 'e2', snapshotId: 1 })).error?.type).toBe(
      'ComputerStaleSnapshot',
    );
    expect(computer.actions().some((call) => call.path === '/click')).toBe(false);
  });

  it('holds Enter on a page that would submit an order, and lets other keys through', async () => {
    const computer = fakeComputer();
    const tools = service();

    expect((await tools.pressKey({ key: 'Tab' })).success).toBe(true);
    await tools.snapshot();

    const typed = await tools.type({ ref: 'e1', snapshotId: 1, submit: true, text: 'x' });
    expect(typed.error?.type).toBe('ComputerNeedsApproval');
    expect(typed.content).toContain('pressKeyWithApproval');
    expect((await tools.pressKey({ key: 'Enter', ref: 'e1', snapshotId: 1 })).error?.type).toBe(
      'ComputerNeedsApproval',
    );

    expect((await tools.type({ ref: 'e1', snapshotId: 1, text: 'Ada' })).success).toBe(true);
    const approved = await tools.pressKeyWithApproval({
      element: 'Place order',
      key: 'Enter',
      ref: 'e1',
      site: 'https://shop.example',
      snapshotId: 1,
    });
    expect(approved.success).toBe(true);

    expect(computer.actions().map((call) => call.path)).toEqual([
      '/key',
      '/snapshot',
      '/type',
      '/key',
    ]);
    expect(computer.actions()[2].body).toEqual({
      ref: 'e1',
      snapshotId: 1,
      submit: false,
      text: 'Ada',
    });
  });

  it('presses Enter freely on a page with nothing to pay, send or delete', async () => {
    fakeComputer([{ name: 'Search', ref: 'e1', role: 'searchbox' } as any]);
    const tools = service();
    await tools.snapshot();

    expect(
      (await tools.type({ ref: 'e1', snapshotId: 1, submit: true, text: 'shoes' })).success,
    ).toBe(true);
  });

  it('asks for the user, and lets their phone know in fixed words', async () => {
    const computer = fakeComputer();
    const result = await service().requestHelp({ reason: 'Solve the CAPTCHA on the login page' });

    expect(result.success).toBe(true);
    expect(computer.actions()[0]).toEqual({
      body: { reason: 'Solve the CAPTCHA on the login page', source: 'model' },
      path: '/control/request',
    });
    expect(pushes.notifications[0]).toMatchObject({
      actionUrl: '/computer',
      dedupeKey: 'computer-help:req-1',
      type: 'computer_help',
    });
    expect(pushes.delivered[0]).toMatchObject({
      data: { kind: 'computer' },
      title: 'Biber needs you',
      translations: { zh: { title: 'Biber 需要你' } },
      userId: 'user-1',
    });
    expect(JSON.stringify(pushes.delivered)).not.toContain('CAPTCHA');
  });

  it('says so where the deployment has no cloud computer', async () => {
    env.sandboxEnv = { ...configured, SANDBOX_PROVIDER: 'market' };
    expect(isCloudComputerAvailable()).toBe(false);
    expect((await service().navigate({ url: 'https://shop.example' })).error?.type).toBe(
      'ComputerUnavailable',
    );

    env.sandboxEnv = configured;
    expect(isCloudComputerAvailable()).toBe(true);
  });
});
