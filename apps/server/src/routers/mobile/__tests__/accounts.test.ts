// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { accountsRouter } from '../accounts';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => testDB) }));

const edition = vi.hoisted(() => ({ region: 'global' }));
vi.mock('@/envs/region', () => ({
  regionEnv: {
    get APP_REGION() {
      return edition.region;
    },
  },
}));

/** Composio, as far as connecting an app goes. */
const composio = vi.hoisted(() => ({
  available: true,
  deleted: [] as string[],
  remoteStatus: 'INITIATED',
}));
vi.mock('@/libs/composio', () => ({
  getComposioClient: () => ({
    authConfigs: {
      create: async () => ({ id: 'ac_new' }),
      list: async () => ({ items: [{ id: 'ac_gmail', toolkit: { slug: 'GMAIL' } }] }),
    },
    connectedAccounts: {
      delete: async (id: string) => composio.deleted.push(id),
      get: async () => ({ status: composio.remoteStatus, toolkit: { slug: 'GMAIL' } }),
      link: async () => ({ id: 'ca_1', redirectUrl: 'https://connect.composio.dev/link/abc' }),
    },
    tools: {
      getRawComposioTools: async () => ({
        items: [{ description: 'Fetch mail', inputParameters: {}, slug: 'GMAIL_FETCH_EMAILS' }],
      }),
    },
  }),
  isComposioClientAvailable: () => composio.available,
}));

/** The mailbox and the calendar, as the phone sees them. */
const services = vi.hoisted(() => ({
  calendarStatus: undefined as any,
  connectMail: vi.fn(),
  feishuAvailable: true,
  mailStatus: undefined as any,
}));
vi.mock('@/server/services/mail', () => {
  class MailConnectError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
    }
  }
  return {
    MailConnectError,
    MailService: class {
      connect = (input: unknown) => services.connectMail(input);
      disconnect = async () => true;
      status = async () => services.mailStatus;
    },
  };
});
vi.mock('@/server/services/calendar', () => {
  class CalendarConnectError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
    }
  }
  return {
    CalendarConnectError,
    CalendarService: class {
      static available = async () => services.feishuAvailable;
      disconnect = async () => true;
      feishuAuthUrl = async () => {
        if (!services.feishuAvailable) throw new CalendarConnectError('unavailable', 'no app');
        return 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=x';
      };
      status = async () => services.calendarStatus;
    },
  };
});

const userId = 'accounts-user';
const caller = () => accountsRouter.createCaller({ jwtPayload: { userId }, userId } as any);

/** Gmail, as the global edition's list shows it. */
const gmail = async () => {
  const list = await caller().list();
  return list.edition === 'global' ? list.apps.find(({ app }) => app === 'gmail') : undefined;
};

const biberPlugins = async () => {
  const [biber] = await testDB
    .select()
    .from(agents)
    .where(and(eq(agents.userId, userId), eq(agents.slug, 'inbox')));
  return biber?.plugins ?? [];
};

beforeEach(async () => {
  testDB = await getTestDB();
  await testDB.delete(users);
  await testDB.insert(users).values({ id: userId });
  edition.region = 'global';
  composio.available = true;
  composio.deleted = [];
  composio.remoteStatus = 'INITIATED';
  services.calendarStatus = undefined;
  services.connectMail.mockReset();
  services.feishuAvailable = true;
  services.mailStatus = undefined;
});

describe('Email & calendar in the global edition', () => {
  it('offers Gmail, Google Calendar and Outlook, none connected', async () => {
    const result = await caller().list();

    expect(result).toEqual({
      apps: [
        { app: 'gmail', label: 'Gmail', status: 'NONE' },
        { app: 'google-calendar', label: 'Google Calendar', status: 'NONE' },
        { app: 'outlook-mail', label: 'Outlook Mail', status: 'NONE' },
      ],
      available: true,
      edition: 'global',
    });
  });

  it('connects Gmail through Composio and gives it to Biber once authorized', async () => {
    const { url } = await caller().connectComposio({ app: 'gmail' });
    expect(url).toBe('https://connect.composio.dev/link/abc');

    // Still authorizing in the browser
    expect((await gmail())?.status).not.toBe('ACTIVE');
    expect(await biberPlugins()).not.toContain('gmail');

    composio.remoteStatus = 'ACTIVE';
    expect(await gmail()).toEqual({
      app: 'gmail',
      label: 'Gmail',
      status: 'ACTIVE',
    });
    expect(await biberPlugins()).toContain('gmail');

    await caller().disconnectComposio({ app: 'gmail' });
    expect(composio.deleted).toEqual(['ca_1']);
    expect(await biberPlugins()).not.toContain('gmail');
    expect((await gmail())?.status).toBe('NONE');
  });

  it('says when this server has no Composio', async () => {
    composio.available = false;

    expect((await caller().list()).available).toBe(false);
    await expect(caller().connectComposio({ app: 'gmail' })).rejects.toMatchObject({
      message: 'COMPOSIO_UNAVAILABLE',
    });
  });
});

describe('Email & calendar in the mainland edition', () => {
  beforeEach(() => {
    edition.region = 'cn';
  });

  it('offers a mailbox with its providers and the Feishu calendar', async () => {
    services.mailStatus = { label: 'ada@qq.com', status: 'needs_reauth' };

    expect(await caller().list()).toEqual({
      calendar: { available: true, connected: false, label: undefined, needsReconnect: false },
      edition: 'cn',
      mail: {
        connected: true,
        label: 'ada@qq.com',
        needsReconnect: true,
        presets: ['qq', '163', '126', 'exmail', 'aliyun', 'qiye163'],
      },
    });
  });

  it('connects a mailbox, and says why when it cannot', async () => {
    services.connectMail.mockResolvedValueOnce({ label: 'ada@qq.com' });
    const input = { address: 'ada@qq.com', password: 'auth-code', preset: 'qq' as const };

    expect(await caller().connectMail(input)).toEqual({ label: 'ada@qq.com' });
    expect(services.connectMail).toHaveBeenCalledWith(input);

    const { MailConnectError } = await import('@/server/services/mail');
    services.connectMail.mockImplementationOnce(async () => {
      throw new MailConnectError('auth', 'LOGIN failed');
    });
    await expect(caller().connectMail(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'MAIL_AUTH',
    });
  });

  it('gives the Feishu authorization page, or says Feishu is not set up', async () => {
    expect((await caller().feishuCalendarAuthUrl()).url).toContain('accounts.feishu.cn');

    services.feishuAvailable = false;
    await expect(caller().feishuCalendarAuthUrl()).rejects.toMatchObject({
      message: 'FEISHU_UNAVAILABLE',
    });
  });
});
