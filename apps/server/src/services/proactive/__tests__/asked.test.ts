// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProactiveMessageModel } from '@/database/models/proactiveMessage';
import { ProactiveSettingsModel } from '@/database/models/proactiveSettings';
import { messages, proactiveThoughts, topics } from '@/database/schemas';
import { users } from '@/database/schemas/user';

import { ASKED_GRACE_MS, askedReminderText, deliverAskedReminders } from '../asked';
import type * as Compose from '../compose';
import { composeProactiveMessage } from '../compose';
import { ProactiveService } from '../service';

const mocks = vi.hoisted(() => ({ deliver: vi.fn(), review: vi.fn() }));

vi.mock('@/database/server', () => ({ serverDB: {} }));
vi.mock('../../push/PushChannel', () => ({
  PushChannel: vi.fn(function () {
    return { deliver: mocks.deliver };
  }),
}));
vi.mock('@/server/services/contentSafety', () => ({ reviewModelReply: mocks.review }));
vi.mock('../compose', async (importOriginal) => ({
  ...(await importOriginal<typeof Compose>()),
  composeProactiveMessage: vi.fn(),
}));

const db = await getTestDB();
const userId = 'proactive-asked-user';
const MINUTE = 60 * 1000;

/** A reminder the user asked for, due `dueInMinutes` from now. */
const ask = async (about: string, dueInMinutes: number) => {
  const dueAt = new Date(Date.now() + dueInMinutes * MINUTE);
  const [row] = await db
    .insert(proactiveThoughts)
    .values({
      dueAt,
      expiresAt: new Date(dueAt.getTime() + ASKED_GRACE_MS),
      kind: 'reminder',
      seed: about,
      source: 'asked',
      sourceRef: `agent:${about}`,
      userId,
    })
    .returning();
  return row;
};

const statusOf = async (id: string) =>
  (await db.select().from(proactiveThoughts).where(eq(proactiveThoughts.id, id)))[0]?.status;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.deliver.mockResolvedValue({ providerMessageId: '[]', status: 'sent' });
  mocks.review.mockResolvedValue('allowed');
  await db.delete(users);
  await db.insert(users).values({ id: userId });
});

describe('deliverAskedReminders', () => {
  it('sends a due reminder at its time, even when Biber is turned off and in quiet hours', async () => {
    const hour = new Date().getUTCHours();
    await new ProactiveSettingsModel(db, userId).update({
      level: 'off',
      quietEnd: (hour + 1) % 24,
      quietStart: hour,
      timeZone: 'UTC',
    });
    const due = await ask('Call mom', -1);
    const later = await ask('Water the plants', 30);

    expect(await deliverAskedReminders(db, new Date())).toEqual({ sent: 1 });

    const [message] = await db.select().from(messages).where(eq(messages.userId, userId));
    expect(message).toMatchObject({ content: 'Reminder: Call mom', role: 'assistant' });
    const [topic] = await db.select().from(topics).where(eq(topics.id, message.topicId!));
    expect(topic.title).toBe('From Biber');

    const [entry] = await new ProactiveMessageModel(db, userId).recent();
    expect(entry).toMatchObject({ kind: 'asked', state: 'sent', thoughtId: due.id });
    expect(mocks.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryId: 'proactive',
        content: 'Reminder: Call mom',
        data: expect.objectContaining({ kind: 'proactive', topicId: message.topicId }),
      }),
    );

    // The chat is remembered, but nothing counts against the day's budget
    expect(await new ProactiveSettingsModel(db, userId).find()).toMatchObject({
      spentToday: 0,
      topicId: message.topicId,
    });
    expect(await statusOf(due.id)).toBe('done');
    expect(await statusOf(later.id)).toBe('open');
  });

  it('sends each reminder once, even when two checks run at the same moment', async () => {
    await ask('Call mom', -1);

    const outcomes = await Promise.all([
      deliverAskedReminders(db, new Date()),
      deliverAskedReminders(db, new Date()),
    ]);

    expect(outcomes.map((outcome) => outcome.sent ?? 0).sort()).toEqual([0, 1]);
    expect(mocks.deliver).toHaveBeenCalledTimes(1);
  });

  it('retries a reminder whose sending failed, and drops one too late to send', async () => {
    const failing = await ask('Call mom', -1);
    mocks.deliver.mockRejectedValueOnce(new Error('push service down'));

    expect(await deliverAskedReminders(db, new Date())).toEqual({ failed: 1 });
    expect(await statusOf(failing.id)).toBe('open');

    expect(await deliverAskedReminders(db, new Date())).toEqual({ sent: 1 });

    const stale = await ask('Pick up the parcel', -(ASKED_GRACE_MS / MINUTE) - 5);
    expect(await deliverAskedReminders(db, new Date())).toEqual({ expired: 1 });
    expect(await statusOf(stale.id)).toBe('expired');
  });

  it('does not send what the content check hides', async () => {
    const hidden = await ask('Something unsafe', -1);
    mocks.review.mockResolvedValue('hidden');

    expect(await deliverAskedReminders(db, new Date())).toEqual({ blocked: 1 });
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await statusOf(hidden.id)).toBe('done');
  });

  it('does not hold back Biber’s own next message, as its time was the user’s', async () => {
    await new ProactiveSettingsModel(db, userId).update({
      quietEnd: 0,
      quietStart: 0,
      timeZone: 'UTC',
    });
    await ask('Call mom', -1);
    await deliverAskedReminders(db, new Date());

    await db.insert(proactiveThoughts).values({
      dueAt: new Date(Date.now() - MINUTE),
      kind: 'follow_up',
      seed: 'How the interview went',
      source: 'agent',
      sourceRef: 'agent:interview',
      userId,
    });
    vi.mocked(composeProactiveMessage).mockImplementation(async (_db, _user, input) => ({
      content: 'How did the interview go?',
      skip: false,
      thoughtId: input.candidates[0].id,
    }));

    expect(await new ProactiveService(db, userId).runForUser()).toMatchObject({ sent: true });
  });
});

describe('askedReminderText', () => {
  it('writes the reminder in the user’s language', () => {
    expect(askedReminderText('给妈妈打电话', 'zh-CN')).toBe('提醒：给妈妈打电话');
    expect(askedReminderText('Call mom', 'en-US')).toBe('Reminder: Call mom');
  });
});
