// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { setBiberTool } from '../biberTools';

let db: LobeChatDatabase;
const userId = 'biber-tools-user';

const biberPlugins = async () => {
  const [biber] = await db.select().from(agents).where(eq(agents.slug, 'inbox'));
  return biber.plugins;
};

beforeEach(async () => {
  db = await getTestDB();
  await db.delete(users);
  await db.insert(users).values({ id: userId });
  await db.insert(agents).values({ plugins: ['web-search'], slug: 'inbox', userId, virtual: true });
});

describe('setBiberTool', () => {
  it('gives Biber the tool of a connected account once, and takes it back', async () => {
    await setBiberTool(db, userId, 'lobe-mail', true);
    await setBiberTool(db, userId, 'lobe-mail', true);
    expect(await biberPlugins()).toEqual(['web-search', 'lobe-mail']);

    await setBiberTool(db, userId, 'lobe-mail', false);
    expect(await biberPlugins()).toEqual(['web-search']);
  });

  it('leaves other agents alone', async () => {
    const [expert] = await db.insert(agents).values({ plugins: [], userId }).returning();

    await setBiberTool(db, userId, 'gmail', true);

    const [after] = await db.select().from(agents).where(eq(agents.id, expert.id));
    expect(after.plugins).toEqual([]);
  });
});
