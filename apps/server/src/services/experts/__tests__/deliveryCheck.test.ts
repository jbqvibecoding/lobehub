// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agents, messagePlugins, messages, topics, userSettings } from '@/database/schemas';
import { users } from '@/database/schemas/user';

import { expertMarketIdentifier } from '../catalog';
import {
  checkFileDelivery,
  deliveryCheckPrompt,
  fileNamesIn,
  isDeliveryCheck,
  undeliveredFiles,
} from '../deliveryCheck';

const mocks = vi.hoisted(() => ({ execAgent: vi.fn(), region: { APP_REGION: 'global' } }));

vi.mock('@/database/server', () => ({ serverDB: {} }));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({ execAgent: mocks.execAgent })),
}));
vi.mock('@/envs/region', () => ({ regionEnv: mocks.region }));

const db = await getTestDB();
const userId = 'delivery-user';

describe('which files a reply names', () => {
  it('finds document names in either language, once each', () => {
    expect(
      fileNamesIn('已生成「季度汇报.pptx」和 report.xlsx，另附 report.XLSX 与 notes.md。'),
    ).toEqual(['季度汇报.pptx', 'report.xlsx', 'notes.md']);
    expect(fileNamesIn('Saved to /workspace/out/Plan v2.docx and plan.pdf.')).toEqual([
      'v2.docx',
      'plan.pdf',
    ]);
    expect(fileNamesIn('A .pptx deck is the right format; see example.com')).toEqual([]);
  });

  it('matches a name run into Chinese text, or cut at a space, to the delivered file', () => {
    expect(
      undeliveredFiles({
        delivered: ['季度汇报.pptx', 'Plan v2.docx'],
        reply: '已生成季度汇报.pptx，另见 Plan v2.docx。',
        userText: '',
      }),
    ).toEqual([]);
  });

  it('leaves out what was delivered and what the user named', () => {
    expect(
      undeliveredFiles({
        delivered: ['deck.pptx'],
        reply: 'Here are deck.pptx and summary.docx, built from your data.xlsx.',
        userText: 'Use data.xlsx to make a deck',
      }),
    ).toEqual(['summary.docx']);
  });

  it('writes the follow-up in the user’s language, and knows it is one', () => {
    const zh = deliveryCheckPrompt(['a.pptx', 'b.xlsx'], 'zh-CN');
    expect(zh).toBe(
      '（交付核对）你在回复里提到了 a.pptx、b.xlsx，但这个对话里还没有交付它。请生成并用 exportFile 交付；做不到的话，直接说明原因。',
    );
    expect(isDeliveryCheck(zh)).toBe(true);
    expect(isDeliveryCheck(deliveryCheckPrompt(['a.pdf'], 'en-US'))).toBe(true);
    expect(isDeliveryCheck('Make a deck')).toBe(false);
  });
});

describe('checkFileDelivery', () => {
  const setUp = async (marketIdentifier: string | null) => {
    await db.insert(agents).values({ id: 'agent-docs', marketIdentifier, userId });
    await db.insert(topics).values({ agentId: 'agent-docs', id: 'topic-docs', userId });
    await db.insert(messages).values({
      content: '做一份季度汇报',
      createdAt: new Date('2026-11-23T01:00:00Z'),
      id: 'msg-user',
      role: 'user',
      topicId: 'topic-docs',
      userId,
    });
  };

  const exported = async (id: string, filename: string, success = true) => {
    await db.insert(messages).values({ id, role: 'tool', topicId: 'topic-docs', userId });
    await db.insert(messagePlugins).values({
      apiName: 'exportFile',
      id,
      identifier: 'lobe-cloud-sandbox',
      state: { filename, success },
      userId,
    });
  };

  const run = (reply: string) =>
    checkFileDelivery(db, userId, undefined, {
      agentId: 'agent-docs',
      reply,
      topicId: 'topic-docs',
    });

  beforeEach(async () => {
    mocks.execAgent.mockReset();
    mocks.region.APP_REGION = 'global';
    await db.delete(users);
    await db.insert(users).values({ id: userId });
  });

  it('runs the documents expert once more when it named a file it never handed over', async () => {
    await db.insert(userSettings).values({ general: { responseLanguage: 'zh-CN' }, id: userId });
    await setUp(expertMarketIdentifier('documents'));
    await exported('msg-deck', 'deck.pptx');
    await exported('msg-broken', 'report.xlsx', false);

    await run('已生成 deck.pptx 和 report.xlsx，请查收。');

    expect(mocks.execAgent).toHaveBeenCalledTimes(1);
    expect(mocks.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-docs',
        appContext: { groupId: undefined, topicId: 'topic-docs' },
        prompt: expect.stringMatching(/^（交付核对）你在回复里提到了 report\.xlsx，/),
      }),
    );
  });

  it('asks in the edition’s language when the user chose none', async () => {
    await setUp(expertMarketIdentifier('documents'));
    await run('Here is summary.docx.');
    mocks.region.APP_REGION = 'cn';
    await run('已生成 summary.docx。');

    expect(mocks.execAgent.mock.calls.map(([call]) => isDeliveryCheck(call.prompt))).toEqual([
      true,
      true,
    ]);
    expect(mocks.execAgent.mock.calls[0][0].prompt).toMatch(/^\(Delivery check\)/);
    expect(mocks.execAgent.mock.calls[1][0].prompt).toMatch(/^（交付核对）/);
  });

  it('does nothing when every named file was delivered, or no file is named', async () => {
    await setUp(expertMarketIdentifier('documents'));
    await exported('msg-deck', 'deck.pptx');

    await run('Here is deck.pptx.');
    await run('I can make a deck if you like.');

    expect(mocks.execAgent).not.toHaveBeenCalled();
  });

  it('checks only file-making experts, and never a reply to its own follow-up', async () => {
    await setUp(expertMarketIdentifier('researcher'));
    await run('See summary.pdf');
    expect(mocks.execAgent).not.toHaveBeenCalled();

    await db.update(agents).set({ marketIdentifier: expertMarketIdentifier('documents') });
    await db.insert(messages).values({
      content: deliveryCheckPrompt(['summary.pdf'], 'zh-CN'),
      createdAt: new Date('2026-11-23T02:00:00Z'),
      id: 'msg-check',
      role: 'user',
      topicId: 'topic-docs',
      userId,
    });
    await run('Sorry, I could not make summary.pdf.');
    expect(mocks.execAgent).not.toHaveBeenCalled();
  });
});
