/**
 * Messages Biber sends on its own, against a running server, through the routes the phone calls
 * and the scheduled call an operator sets up:
 * - an activity in the user's memory that starts tomorrow becomes a reminder in the "From Biber"
 *   chat, pushed with a "Not now" button and entered in the results ledger;
 * - the phone's tap counts as opened;
 * - the next check says nothing: a message went out less than two hours ago;
 * - inside the user's quiet hours nothing goes out either;
 * - a starter routine's result is pushed and opens the routine's task;
 * - the workflow endpoints turn away a call without the scheduler's secret (not on a development
 *   server, which accepts unsigned workflow calls: set SMOKE_DEV_SERVER=1 against `next dev`).
 *
 *   SMOKE_DATABASE_URL=postgres://… SMOKE_CRON_SECRET=… bunx tsx scripts/biber/smoke/proactive.ts
 *
 * The server needs CRON_SECRET (the same value), the fake model (OPENAI_PROXY_URL or
 * DEEPSEEK_PROXY_URL=http://127.0.0.1:4010/v1) and EXPO_BASE_URL=http://127.0.0.1:4020; the
 * mainland edition also ALIYUN_GREEN_ENDPOINT=http://127.0.0.1:4090, and the script then checks
 * that the message went through content moderation (it reads APP_REGION=cn for that). The script
 * writes the activity straight into the database: memory extraction runs on Upstash workflows,
 * which do not run locally.
 */
import pg from 'pg';

import { SmokeClient, waitFor } from './client';
import {
  type PushRequest,
  startFakeContentSafety,
  startFakeExpoPush,
  startFakeModel,
} from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const DATABASE_URL = process.env.SMOKE_DATABASE_URL ?? process.env.DATABASE_URL;
const CRON_SECRET = process.env.SMOKE_CRON_SECRET;
const MAINLAND = process.env.APP_REGION === 'cn';
const HOUR = 60 * 60 * 1000;

const steps: { name: string; ok: boolean }[] = [];
const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
  try {
    const value = await run();
    steps.push({ name, ok: true });
    console.log(`✓ ${name}`);
    return value;
  } catch (error) {
    steps.push({ name, ok: false });
    console.log(`✗ ${name}: ${error}`);
    throw error;
  }
};

interface Thought {
  id: string;
  kind: string;
  seed: string;
}

const main = async () => {
  if (!DATABASE_URL) throw new Error('Set SMOKE_DATABASE_URL to the server’s database');
  if (!CRON_SECRET) throw new Error('Set SMOKE_CRON_SECRET to the server’s CRON_SECRET');
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const push = await startFakeExpoPush(Number(process.env.SMOKE_PUSH_PORT ?? 4020));
  // The mainland edition sends nothing it could not check
  const contentSafety = await startFakeContentSafety(
    Number(process.env.SMOKE_CONTENT_SAFETY_PORT ?? 4090),
  );
  const client = new SmokeClient(BASE_URL);
  const stamp = Date.now();
  const expoToken = `ExponentPushToken[proactive-${stamp}]`;

  const tick = async (secret = CRON_SECRET) => {
    const response = await fetch(`${BASE_URL}/api/workflows/proactive/tick`, {
      headers: { Authorization: `Bearer ${secret}` },
      method: 'POST',
    });
    if (!response.ok) throw new Error(`tick: HTTP ${response.status} ${await response.text()}`);
    return (await response.json()) as { checked: number; outcomes: Record<string, number> };
  };
  const pushesTo = (kind: string) =>
    push.sent.filter((sent: PushRequest) => sent.to === expoToken && sent.data?.kind === kind);
  const ledger = async (userId: string) =>
    (
      await db.query(
        'select kind, state, routine_id, topic_id from proactive_messages where user_id = $1 order by sent_at',
        [userId],
      )
    ).rows;

  /** An activity remembered from a chat, starting `hoursFromNow` from now. */
  const remember = async (userId: string, title: string, hoursFromNow: number) => {
    const id = `smoke-${title.replaceAll(' ', '-')}-${stamp}`;
    await db.query(
      `insert into user_memories (id, user_id, title, last_accessed_at) values ($1, $2, $3, now())`,
      [`mem-${id}`, userId, title],
    );
    await db.query(
      `insert into user_memories_activities (id, user_id, user_memory_id, type, starts_at)
       values ($1, $2, $3, 'event', $4)`,
      [id, userId, `mem-${id}`, new Date(Date.now() + hoursFromNow * HOUR)],
    );
  };

  /** Moves the user's last check (and optionally last send) back, as if time had passed. */
  const rewind = (userId: string, sentHoursAgo?: number) =>
    db.query(
      `update proactive_settings set last_attempt_at = now() - interval '1 hour'
       ${sentHoursAgo === undefined ? '' : `, last_sent_at = now() - interval '${sentHoursAgo} hours'`}
       where user_id = $1`,
      [userId],
    );

  try {
    const email = `proactive-${stamp}@biber.test`;
    await client.signUp(email, 'Smoke-pass-12345', 'Proactive');
    const { rows } = await db.query('select id from users where email = $1', [email]);
    const userId: string = rows[0].id;

    await client.mutation('mobile', 'pushToken.register', {
      deviceId: `proactive-${stamp}`,
      expoToken,
      locale: 'en-US',
      platform: 'ios',
    });
    // No quiet hours yet, so the time of day the smoke runs at does not matter
    await client.mutation('mobile', 'proactive.updateSettings', {
      quietEnd: 0,
      quietStart: 0,
      timeZone: 'UTC',
    });

    const reminder = await step(
      'an activity starting tomorrow becomes a reminder in the From Biber chat, pushed',
      async () => {
        await remember(userId, 'Dentist appointment', 20);
        const result = await tick();
        if (!result.outcomes.sent) throw new Error(`nothing sent: ${JSON.stringify(result)}`);

        const sent = await waitFor('the push', async () => pushesTo('proactive')[0], 10_000);
        if (sent.categoryId !== 'proactive' || !sent.body.includes('Dentist appointment')) {
          throw new Error(JSON.stringify(sent));
        }
        const [entry] = await ledger(userId);
        if (entry?.kind !== 'reminder' || entry.state !== 'sent' || !entry.topic_id) {
          throw new Error(JSON.stringify(entry));
        }
        const { rows: chat } = await db.query(
          `select m.content, t.title from messages m join topics t on t.id = m.topic_id
           where m.user_id = $1 and m.topic_id = $2`,
          [userId, entry.topic_id],
        );
        if (chat.length !== 1 || chat[0].title !== 'From Biber' || chat[0].content !== sent.body) {
          throw new Error(JSON.stringify(chat));
        }
        const thoughts = await client.query<Thought[]>('mobile', 'proactive.listThoughts');
        if (thoughts.length > 0) throw new Error(`still to say: ${JSON.stringify(thoughts)}`);
        const checked = contentSafety.checks.some(
          (check) => check.service === 'llm_response_moderation' && check.content === sent.body,
        );
        if (MAINLAND && !checked) throw new Error('the message skipped content moderation');
        return sent;
      },
    );

    await step('the phone’s tap counts as opened', async () => {
      const result = await client.mutation<{ state: string }>('mobile', 'proactive.opened', {
        id: reminder.data!.outcomeId,
      });
      if (result.state !== 'opened') throw new Error(JSON.stringify(result));
    });

    await step('the next check says nothing within two hours of the last message', async () => {
      await remember(userId, 'Flight to Tokyo', 30);
      await rewind(userId);
      const result = await tick();
      if (!result.outcomes.too_soon) throw new Error(JSON.stringify(result));
      if (pushesTo('proactive').length !== 1) throw new Error('a second message went out');
      const thoughts = await client.query<Thought[]>('mobile', 'proactive.listThoughts');
      if (!thoughts.some((thought) => thought.seed === 'Flight to Tokyo')) {
        throw new Error(`the flight is not waiting: ${JSON.stringify(thoughts)}`);
      }
    });

    await step('inside quiet hours nothing goes out', async () => {
      const hour = new Date().getUTCHours();
      await client.mutation('mobile', 'proactive.updateSettings', {
        quietEnd: (hour + 1) % 24,
        quietStart: hour,
      });
      await rewind(userId, 3);
      const result = await tick();
      if (!result.outcomes.quiet_hours) throw new Error(JSON.stringify(result));
      if (pushesTo('proactive').length !== 1) throw new Error('a message went out in quiet hours');
    });

    await step('a starter routine’s result is pushed and opens its task', async () => {
      const { taskId } = await client.mutation<{ taskId: string }>('mobile', 'routines.enable', {
        id: 'morning-brief',
        locale: 'en-US',
        timeZone: 'UTC',
      });
      // Biber's own model has no key locally: run it on the fake model the server points at
      await db.query(
        `update agents set provider = $1, model = $2 where user_id = $3 and slug = 'inbox'`,
        [
          process.env.SMOKE_MODEL_PROVIDER ?? 'openai',
          process.env.SMOKE_MODEL ?? 'gpt-4o-mini',
          userId,
        ],
      );
      await client.mutation('lambda', 'task.run', { id: taskId });
      const sent = await waitFor('the routine push', async () => pushesTo('routine')[0], 120_000);
      if (sent.title !== 'Morning brief' || sent.data?.taskId !== taskId) {
        throw new Error(JSON.stringify(sent));
      }
      const entries = await ledger(userId);
      if (
        !entries.some((entry) => entry.kind === 'routine' && entry.routine_id === 'morning-brief')
      ) {
        throw new Error(JSON.stringify(entries));
      }
      await client.mutation('mobile', 'routines.disable', { id: 'morning-brief' });
    });

    await step('workflow endpoints turn away a call without the scheduler’s secret', async () => {
      // Upstream lets a development server (`next dev`) without QStash keys run workflows
      // unsigned, for local execution; production refuses them (qstashAuth.test.ts pins it)
      if (process.env.SMOKE_DEV_SERVER === '1') {
        console.log('  (SMOKE_DEV_SERVER=1: a development server accepts unsigned workflow calls)');
        return;
      }
      for (const path of [
        '/api/workflows/proactive/tick',
        '/api/workflows/task/schedule-execute',
      ]) {
        const response = await fetch(`${BASE_URL}${path}`, {
          body: JSON.stringify({ taskId: 'anything' }),
          headers: { 'Authorization': 'Bearer guess', 'Content-Type': 'application/json' },
          method: 'POST',
        });
        if (response.status !== 401) throw new Error(`${path} answered ${response.status}`);
      }
    });
  } finally {
    model.close();
    push.close();
    contentSafety.close();
    await db.end();
    const failed = steps.filter((s) => !s.ok).length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
  }
};

main().then(
  () => process.exit(0),
  (error) => {
    console.error(String(error));
    process.exit(1);
  },
);
