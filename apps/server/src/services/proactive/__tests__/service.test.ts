// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProactiveMessageModel } from '@/database/models/proactiveMessage';
import { ProactiveSettingsModel } from '@/database/models/proactiveSettings';
import {
  messages,
  proactiveThoughts,
  userMemories,
  userMemoriesActivities,
} from '@/database/schemas';
import { users } from '@/database/schemas/user';

import type * as Compose from '../compose';
import { composeProactiveMessage } from '../compose';
import { ProactiveService } from '../service';

const mocks = vi.hoisted(() => ({ deliver: vi.fn(), review: vi.fn() }));

vi.mock('@/database/server', () => ({ serverDB: {} }));
vi.mock('../../push/PushChannel', () => ({
  PushChannel: vi.fn(() => ({ deliver: mocks.deliver })),
}));
vi.mock('@/server/services/contentSafety', () => ({ reviewModelReply: mocks.review }));
vi.mock('../compose', async (importOriginal) => ({
  ...(await importOriginal<typeof Compose>()),
  composeProactiveMessage: vi.fn(),
}));

const db = await getTestDB();
const userId = 'proactive-service-user';
const HOUR = 60 * 60 * 1000;

/** An activity remembered from a chat, starting `hoursFromNow` from now. */
const remember = async (id: string, title: string, hoursFromNow: number) => {
  await db
    .insert(userMemories)
    .values({ id: `mem-${id}`, lastAccessedAt: new Date(), title, userId });
  await db.insert(userMemoriesActivities).values({
    id,
    startsAt: new Date(Date.now() + hoursFromNow * HOUR),
    type: 'event',
    userId,
    userMemoryId: `mem-${id}`,
  });
};

/** Quiet hours off, so the time of day the tests run at does not matter. */
const allowAllDay = () =>
  new ProactiveSettingsModel(db, userId).update({ quietEnd: 0, quietStart: 0, timeZone: 'UTC' });

const composeWrites = (content: string) =>
  vi.mocked(composeProactiveMessage).mockImplementation(async (_db, _user, input) => ({
    content,
    skip: false,
    thoughtId: input.candidates[0].id,
  }));

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.deliver.mockResolvedValue({ providerMessageId: '[]', status: 'sent' });
  mocks.review.mockResolvedValue('allowed');
  await db.delete(users);
  await db.insert(users).values({ id: userId });
});

describe('ProactiveService.runForUser', () => {
  it('reminds of tomorrow’s activity in the From Biber chat, pushes it, and says it once', async () => {
    await allowAllDay();
    await remember('act-1', 'Dentist at 10', 20);
    composeWrites('Dentist tomorrow at 10. Leave by 9:30.');

    const result = await new ProactiveService(db, userId).runForUser();
    expect(result).toMatchObject({ sent: true });

    const [message] = await db.select().from(messages).where(eq(messages.userId, userId));
    expect(message).toMatchObject({
      content: 'Dentist tomorrow at 10. Leave by 9:30.',
      role: 'assistant',
    });
    const [thought] = await db.select().from(proactiveThoughts);
    expect(thought).toMatchObject({ kind: 'reminder', status: 'done' });

    const [entry] = await new ProactiveMessageModel(db, userId).recent();
    expect(entry).toMatchObject({
      kind: 'reminder',
      state: 'sent',
      thoughtId: thought.id,
      title: 'Dentist tomorrow at 10. Leave by 9:30.',
      topicId: message.topicId,
    });
    expect(mocks.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryId: 'proactive',
        data: {
          agentId: message.agentId,
          kind: 'proactive',
          outcomeId: entry.id,
          topicId: message.topicId,
        },
      }),
    );
    expect(await new ProactiveSettingsModel(db, userId).find()).toMatchObject({
      spentToday: 1,
      topicId: message.topicId,
    });

    // The next check finds the same activity but nothing new to say
    const later = new Date(Date.now() + 3 * HOUR);
    expect(await new ProactiveService(db, userId).runForUser(later)).toEqual({
      reason: 'no_candidates',
      sent: false,
    });
  });

  it('lets one check run at a time and spaces messages two hours apart', async () => {
    await allowAllDay();
    await remember('act-1', 'Dentist', 20);
    await remember('act-2', 'Flight to Tokyo', 40);
    composeWrites('Dentist tomorrow.');
    const service = new ProactiveService(db, userId);

    expect(await service.runForUser()).toMatchObject({ sent: true });
    expect(await service.runForUser()).toEqual({ reason: 'busy', sent: false });
    expect(await service.runForUser(new Date(Date.now() + 40 * 60 * 1000))).toEqual({
      reason: 'too_soon',
      sent: false,
    });
  });

  it('keeps quiet hours in the user’s time zone, and says nothing when turned off', async () => {
    const hour = new Date().getUTCHours();
    await new ProactiveSettingsModel(db, userId).update({
      quietEnd: (hour + 1) % 24,
      quietStart: hour,
      timeZone: 'UTC',
    });
    await remember('act-1', 'Dentist', 20);

    expect(await new ProactiveService(db, userId).runForUser()).toEqual({
      reason: 'quiet_hours',
      sent: false,
    });

    await new ProactiveSettingsModel(db, userId).update({
      level: 'off',
      quietEnd: 0,
      quietStart: 0,
    });
    expect(await new ProactiveService(db, userId).runForUser(new Date(Date.now() + HOUR))).toEqual({
      reason: 'off',
      sent: false,
    });
    expect(composeProactiveMessage).not.toHaveBeenCalled();
  });

  it('asks the model only when there is something to say, and keeps the thought when it skips', async () => {
    await allowAllDay();
    const service = new ProactiveService(db, userId);

    expect(await service.runForUser()).toEqual({ reason: 'no_candidates', sent: false });
    expect(composeProactiveMessage).not.toHaveBeenCalled();

    await remember('act-1', 'Dentist', 20);
    vi.mocked(composeProactiveMessage).mockResolvedValue({ skip: true });
    expect(await service.runForUser(new Date(Date.now() + HOUR))).toEqual({
      reason: 'model_skipped',
      sent: false,
    });
    const [thought] = await db.select().from(proactiveThoughts);
    expect(thought.status).toBe('open');
  });

  it('sends nothing the content check hides', async () => {
    await allowAllDay();
    await remember('act-1', 'Dentist', 20);
    composeWrites('Dentist tomorrow.');
    mocks.review.mockResolvedValue('hidden');

    expect(await new ProactiveService(db, userId).runForUser()).toEqual({
      reason: 'blocked',
      sent: false,
    });
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(await db.select().from(messages).where(eq(messages.userId, userId))).toEqual([]);
  });

  it('counts a message as answered once the user writes back in its chat', async () => {
    await allowAllDay();
    await remember('act-1', 'Dentist', 20);
    composeWrites('Dentist tomorrow.');
    const service = new ProactiveService(db, userId);
    await service.runForUser();
    const [entry] = await new ProactiveMessageModel(db, userId).recent();

    await db.insert(messages).values({
      agentId: entry.agentId,
      content: 'Thanks!',
      createdAt: new Date(Date.now() + 60 * 1000),
      role: 'user',
      topicId: entry.topicId,
      userId,
    });
    await service.runForUser(new Date(Date.now() + 3 * HOUR));

    expect((await new ProactiveMessageModel(db, userId).findById(entry.id))?.state).toBe('replied');
  });
});

describe('ProactiveService.dueUsers', () => {
  it('picks users with something coming up, and leaves out those who turned it off', async () => {
    const quietUser = 'proactive-quiet-user';
    await db.insert(users).values({ id: quietUser });
    await remember('act-1', 'Dentist', 20);
    await db.insert(userMemoriesActivities).values({
      id: 'act-quiet',
      startsAt: new Date(Date.now() + 20 * HOUR),
      type: 'event',
      userId: quietUser,
    });
    await new ProactiveSettingsModel(db, quietUser).update({ level: 'off' });

    expect(await ProactiveService.dueUsers(db, new Date())).toEqual([userId]);
  });

  it('waits for a note’s time, and leaves out reminders the user asked for', async () => {
    const note = (id: string, source: 'agent' | 'asked', dueInHours: number) => ({
      dueAt: new Date(Date.now() + dueInHours * HOUR),
      kind: 'follow_up' as const,
      seed: 'How did it go?',
      source,
      sourceRef: `agent:${id}`,
      userId,
    });
    await db
      .insert(proactiveThoughts)
      .values([note('later', 'agent', 5), note('asked', 'asked', -1)]);
    expect(await ProactiveService.dueUsers(db, new Date())).toEqual([]);

    await db.insert(proactiveThoughts).values(note('due', 'agent', -1));
    expect(await ProactiveService.dueUsers(db, new Date())).toEqual([userId]);
  });
});
