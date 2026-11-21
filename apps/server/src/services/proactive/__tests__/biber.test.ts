// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProactiveSettingsModel } from '@/database/models/proactiveSettings';
import { UserModel } from '@/database/models/user';
import { users } from '@/database/schemas/user';

import { resolveTimeZone } from '../biber';

const region = vi.hoisted(() => ({ APP_REGION: 'global' as string }));
vi.mock('@/envs/region', () => ({ regionEnv: region }));
vi.mock('@/database/server', () => ({ serverDB: {} }));

const db = await getTestDB();
const userId = 'proactive-biber-user';

beforeEach(async () => {
  region.APP_REGION = 'global';
  await db.delete(users);
  await db.insert(users).values({ id: userId });
});

describe('resolveTimeZone', () => {
  it('takes the phone’s zone, then the web setting’s, then the edition’s home', async () => {
    expect(await resolveTimeZone(db, userId)).toBe('UTC');
    region.APP_REGION = 'cn';
    expect(await resolveTimeZone(db, userId)).toBe('Asia/Shanghai');

    await new UserModel(db, userId).updateSetting({
      general: { timezone: 'Europe/Berlin' },
    } as any);
    expect(await resolveTimeZone(db, userId)).toBe('Europe/Berlin');

    await new ProactiveSettingsModel(db, userId).update({ timeZone: 'America/New_York' });
    expect(await resolveTimeZone(db, userId)).toBe('America/New_York');
  });

  it('skips a zone that is not a real one', async () => {
    await new ProactiveSettingsModel(db, userId).update({ timeZone: 'Mars/Olympus' });
    expect(await resolveTimeZone(db, userId)).toBe('UTC');
  });
});
