// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agents, topics } from '@/database/schemas';
import { users } from '@/database/schemas/user';

import { expertMarketIdentifier, EXPERTS } from '../catalog';
import { ExpertService } from '../index';

vi.mock('@/database/server', () => ({ serverDB: {} }));

const db = await getTestDB();
const userId = 'experts-user';
const otherId = 'experts-other';

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: otherId }]);
});

describe('ExpertService', () => {
  it('lists the whole roster in the user’s language, none added yet', async () => {
    const list = await new ExpertService(db, userId).list('zh-CN');

    expect(list.map((expert) => expert.id)).toEqual(EXPERTS.map((expert) => expert.id));
    expect(list.find((expert) => expert.id === 'researcher')).toMatchObject({
      agentId: null,
      title: '研究员',
    });
  });

  it('adds an expert as an ordinary agent of the user, once', async () => {
    const experts = new ExpertService(db, userId);

    const first = await experts.add('researcher', 'en-US');
    const again = await experts.add('researcher', 'en-US');

    expect(first).toMatchObject({ created: true });
    expect(again).toEqual({ agentId: first!.agentId, created: false });
    const [agent] = await db.select().from(agents).where(eq(agents.id, first!.agentId));
    expect(agent).toMatchObject({
      marketIdentifier: expertMarketIdentifier('researcher'),
      title: 'Researcher',
      userId,
      virtual: false,
    });
    expect(agent.systemRole).toContain('You are Researcher');
    expect(
      (await experts.list('en-US')).find((expert) => expert.id === 'researcher'),
    ).toMatchObject({ agentId: first!.agentId });
    expect(await experts.add('no-such-expert', 'en-US')).toBeUndefined();
  });

  it('keeps each user’s roster to themselves', async () => {
    const { agentId } = (await new ExpertService(db, userId).add('writer', 'en-US'))!;
    const other = new ExpertService(db, otherId);

    expect((await other.list('en-US')).every((expert) => expert.agentId === null)).toBe(true);
    expect(await other.remove('writer')).toBe(false);
    expect(await db.select().from(agents).where(eq(agents.id, agentId))).toHaveLength(1);
  });

  it('removes the expert and the chats with it', async () => {
    const experts = new ExpertService(db, userId);
    const { agentId } = (await experts.add('seo', 'en-US'))!;
    await db.insert(topics).values({ agentId, title: 'Audit my page', userId });

    expect(await experts.remove('seo')).toBe(true);
    expect(await db.select().from(agents).where(eq(agents.id, agentId))).toHaveLength(0);
    expect(await db.select().from(topics).where(eq(topics.agentId, agentId))).toHaveLength(0);
    expect(await experts.remove('seo')).toBe(false);
  });
});
