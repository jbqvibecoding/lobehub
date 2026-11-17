import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { TaskModel } from '@/database/models/task';
import { tasks } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { TaskService } from '@/server/services/task';

const log = debug('lobe-server:starter-routines');

type Language = 'en' | 'zh';

interface RoutineText {
  description: string;
  instruction: string;
  name: string;
}

/**
 * Routines a new user can turn on with one tap: Biber, their default assistant, runs each on a
 * schedule. None runs until the user turns it on. A run that needs approval asks the phone, as
 * every run nobody is watching does (decision 5).
 */
export const STARTER_ROUTINES: {
  id: string;
  schedulePattern: string;
  text: Record<Language, RoutineText>;
}[] = [
  {
    id: 'morning-brief',
    schedulePattern: '30 7 * * *',
    text: {
      en: {
        description:
          "Every day at 7:30: today's calendar, important unread email, and what waits for you.",
        instruction:
          'Give me a short morning brief for today: my calendar, important unread email, and anything waiting for my answer. Keep it to five bullet points, most urgent first. If my calendar or email is not connected, say so in one line instead of guessing.',
        name: 'Morning brief',
      },
      zh: {
        description: '每天 7:30：今天的日程、重要的未读邮件，以及在等你回复的事。',
        instruction:
          '给我一份简短的今日晨报：今天的日程、重要的未读邮件，以及在等我回复的事。最多五条，最急的放在最前面。如果日历或邮箱没有连接，用一句话说明，不要猜。',
        name: '晨报',
      },
    },
  },
  {
    id: 'evening-wrap',
    schedulePattern: '30 18 * * 1-5',
    text: {
      en: {
        description:
          'Weekdays at 18:30: what got done today, what is still open, and where to start tomorrow.',
        instruction:
          'Wrap up my day: what got done today, what is still open, and the one thing to start with tomorrow. Keep it short.',
        name: 'Evening wrap-up',
      },
      zh: {
        description: '工作日 18:30：今天做完了什么、还有什么没完成、明天从哪开始。',
        instruction:
          '帮我做个今日小结：今天做完了什么、还有什么没完成，明天最先做哪件事。简短一些。',
        name: '下班小结',
      },
    },
  },
  {
    id: 'weekly-review',
    schedulePattern: '0 17 * * 5',
    text: {
      en: {
        description:
          'Fridays at 17:00: the week in review, and three things to focus on next week.',
        instruction:
          'Review my week: what got done, what slipped, and the three things to focus on next week.',
        name: 'Weekly review',
      },
      zh: {
        description: '每周五 17:00：回顾这一周，并给出下周最该关注的三件事。',
        instruction: '帮我回顾这一周：完成了什么、拖延了什么，以及下周最该关注的三件事。',
        name: '每周回顾',
      },
    },
  },
];

const languageOf = (locale: string | undefined): Language =>
  locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en';

/** The user's time zone when the runtime knows it, else UTC. */
const validTimeZone = (timeZone: string | undefined) => {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
};

const routineOrThrow = (id: string) => {
  const routine = STARTER_ROUTINES.find((item) => item.id === id);
  if (!routine) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such routine' });
  return routine;
};

/** Turns the starter routines on and off for one user, as tasks Biber runs on a schedule. */
export class StarterRoutineService {
  private readonly taskModel: TaskModel;
  private readonly taskService: TaskService;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {
    this.taskModel = new TaskModel(db, userId);
    this.taskService = new TaskService(db, userId);
  }

  /** The routines in the user's language, with whether each is on. */
  async list(locale?: string) {
    const language = languageOf(locale);
    const existing = await this.existingTasks();

    return STARTER_ROUTINES.map((routine) => {
      const task = existing.get(routine.id);
      return {
        ...routine.text[language],
        enabled: task?.automationMode === 'schedule',
        id: routine.id,
        schedulePattern: routine.schedulePattern,
        taskId: task?.id,
      };
    });
  }

  /** Creates the routine's task for Biber, or schedules it again if it was turned off. */
  async enable({ id, locale, timeZone }: { id: string; locale?: string; timeZone?: string }) {
    const routine = routineOrThrow(id);
    const scheduleTimezone = validTimeZone(timeZone);
    const existing = (await this.existingTasks()).get(id);

    let taskId = existing?.id;
    if (taskId) {
      await this.taskModel.update(taskId, {
        automationMode: 'schedule',
        schedulePattern: routine.schedulePattern,
        scheduleTimezone,
      });
    } else {
      const biber = await new AgentModel(this.db, this.userId).getBuiltinAgent(
        BUILTIN_AGENT_SLUGS.inbox,
      );
      const text = routine.text[languageOf(locale)];
      const task = await this.taskService.createTask({
        assigneeAgentId: biber?.id,
        automationMode: 'schedule',
        context: { starterRoutine: id },
        description: text.description,
        instruction: text.instruction,
        name: text.name,
        schedulePattern: routine.schedulePattern,
        scheduleTimezone,
      });
      taskId = task.id;
    }

    if (existing?.status !== 'running' && existing?.status !== 'scheduled') {
      await this.taskService.updateStatus({ id: taskId, status: 'scheduled' });
    }
    log('enabled %s for %s (%s)', id, this.userId, scheduleTimezone);
    return { taskId };
  }

  /** Stops scheduling the routine; its task and history stay. */
  async disable({ id }: { id: string }) {
    routineOrThrow(id);
    const existing = (await this.existingTasks()).get(id);
    if (!existing) return { taskId: undefined };

    await this.taskModel.update(existing.id, { automationMode: null });
    if (existing.status === 'scheduled') {
      await this.taskService.updateStatus({ id: existing.id, status: 'backlog' });
    }
    log('disabled %s for %s', id, this.userId);
    return { taskId: existing.id };
  }

  /** The user's own (personal) tasks created from a starter routine, by routine. */
  private async existingTasks() {
    const rows = await this.db
      .select({
        automationMode: tasks.automationMode,
        id: tasks.id,
        routine: sql<string>`${tasks.context}->>'starterRoutine'`,
        status: tasks.status,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.createdByUserId, this.userId),
          isNull(tasks.workspaceId),
          isNotNull(sql`${tasks.context}->>'starterRoutine'`),
        ),
      );
    return new Map(rows.map((row) => [row.routine, row]));
  }
}
