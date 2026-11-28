// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agents, topics } from '@/database/schemas';
import { users } from '@/database/schemas/user';

import { expertMarketIdentifier, EXPERTS } from '../catalog';
import { ExpertService } from '../index';

vi.mock('@/database/server', () => ({ serverDB: {} }));
const sandbox = vi.hoisted(() => ({ kind: 'market' }));
vi.mock('@/server/services/sandbox/deployment', () => ({
  getSandboxProviderKind: () => sandbox.kind,
}));

const db = await getTestDB();
const userId = 'experts-user';
const otherId = 'experts-other';

beforeEach(async () => {
  sandbox.kind = 'market';
  await db.delete(users);
  await db.insert(users).values([{ id: userId }, { id: otherId }]);
});

describe('ExpertService', () => {
  it('lists the whole roster in the user’s language, none added yet', async () => {
    const list = await new ExpertService(db, userId).list('zh-CN');

    // The coding expert needs the coding computer, which the Market sandbox does not have
    expect(list.map((expert) => expert.id)).toEqual(
      EXPERTS.filter((expert) => expert.id !== 'coder').map((expert) => expert.id),
    );
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
      chatConfig: { searchMode: 'auto', toolMode: 'custom' },
      marketIdentifier: expertMarketIdentifier('researcher'),
      plugins: ['lobe-web-browsing'],
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

  it('gives the document maker the cloud sandbox to make files with', async () => {
    const { agentId } = (await new ExpertService(db, userId).add('documents', 'zh-CN'))!;

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(agent).toMatchObject({
      // The sandbox is where it runs, so its tools are part of the run's tool set
      agencyConfig: { executionTarget: 'sandbox' },
      chatConfig: { searchMode: 'auto', toolMode: 'custom' },
      marketIdentifier: expertMarketIdentifier('documents'),
      plugins: ['lobe-web-browsing', 'lobe-cloud-sandbox'],
      title: '文档助手',
    });
    expect(agent.systemRole).toContain('hand over with exportFile');
    expect(agent.systemRole).not.toContain('You can search the web and read pages. You cannot');
  });

  it('offers the coder where the coding computer runs, as a Claude Code agent', async () => {
    const experts = new ExpertService(db, userId);
    expect(await experts.add('coder', 'en-US')).toBeUndefined();

    sandbox.kind = 'openbot';
    expect((await experts.list('zh-CN')).find((expert) => expert.id === 'coder')).toMatchObject({
      title: '编程助手',
    });
    const { agentId } = (await experts.add('coder', 'zh-CN'))!;
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(agent.agencyConfig).toMatchObject({
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'claude-code' },
    });
    expect(agent.agencyConfig?.heterogeneousProvider?.systemContext).toContain('push_changes');
    expect(agent.plugins).toEqual([]);
  });

  it('gives an expert without tools of its own web search and reading only, and says so', () => {
    for (const expert of EXPERTS.filter((item) => !item.plugins)) {
      expect(expert.systemRole).toContain('You can search the web and read pages.');
      expect(expert.systemRole).toContain('Reply in the language the user writes in.');
    }
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
