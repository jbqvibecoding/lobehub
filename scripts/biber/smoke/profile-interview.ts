/**
 * The "About you" interview and what comes of it, against a running server, through the phone's
 * routes and the scheduled check:
 * - a new user is invited, and "Later" puts the invite away for good;
 * - the interview runs in a conversation of its own, with its instructions in the model's request
 *   from the first answer on: Biber asks the name first, saves each answer (G0, PE0, PR0) and
 *   finishes on "enough";
 * - any other conversation carries the profile, ids and all, and never the interview's rules;
 * - a change or a deletion on the phone is what Biber reads next time;
 * - an entry gone out of date is asked about once in the "From Biber" chat, and "still holds"
 *   confirms it, so it is not asked about again;
 * - another account can neither read nor change the profile, nor open the interview.
 *
 *   SMOKE_DATABASE_URL=postgres://… SMOKE_CRON_SECRET=… bunx tsx scripts/biber/smoke/profile-interview.ts
 *
 * The server needs what reminders.ts needs (CRON_SECRET, the fake model, EXPO_BASE_URL and, on the
 * mainland edition, ALIYUN_GREEN_ENDPOINT); run the script with APP_REGION=cn,
 * SMOKE_MODEL_PROVIDER=deepseek and SMOKE_MODEL=deepseek-v4-flash there. On the mainland edition
 * the user answers in Chinese. The script moves times in the database instead of waiting.
 */
import pg from 'pg';

import { SmokeClient, waitFor } from './client';
import {
  type ModelRequest,
  type PushRequest,
  startFakeContentSafety,
  startFakeExpoPush,
  startFakeModel,
} from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const DATABASE_URL = process.env.SMOKE_DATABASE_URL ?? process.env.DATABASE_URL;
const CRON_SECRET = process.env.SMOKE_CRON_SECRET;
const MAINLAND = process.env.APP_REGION === 'cn';

/** What the user says, in the edition's language. */
const SAY = MAINLAND
  ? {
      done: '先到这',
      goal: '我的目标是十月前跑完全马',
      goalChanged: '十一月前跑完全马',
      locale: 'zh-CN',
      name: '叫我小安',
      person: '我太太叫林',
      project: '我在做 Biber 的手机端',
      stillHolds: '还是这样',
    }
  : {
      done: "that's enough",
      goal: 'My goal is to run a full marathon before October',
      goalChanged: 'Run a full marathon before November',
      locale: 'en-US',
      name: 'Call me An',
      person: 'My wife is called Lin',
      project: 'I am working on the Biber phone app',
      stillHolds: 'still holds',
    };

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

interface ChatHistory {
  lines: { kind: string; text?: string }[];
  run: 'idle' | 'running' | 'waiting';
}

interface Profile {
  entries: { id: string; reviewedAt?: string; section: string; text: string }[];
  interview: { finishedAt?: string; startedAt?: string; topicId?: string };
}

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => part?.text ?? '').join('')
      : '';

/** Everything the model was given in one request, as one string. */
const promptOf = (request: ModelRequest) =>
  request.messages.map((message) => textOf(message.content)).join('\n');

const main = async () => {
  if (!DATABASE_URL) throw new Error('Set SMOKE_DATABASE_URL to the server’s database');
  if (!CRON_SECRET) throw new Error('Set SMOKE_CRON_SECRET to the server’s CRON_SECRET');
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const push = await startFakeExpoPush(Number(process.env.SMOKE_PUSH_PORT ?? 4020));
  const contentSafety = await startFakeContentSafety(
    Number(process.env.SMOKE_CONTENT_SAFETY_PORT ?? 4090),
  );
  const client = new SmokeClient(BASE_URL);
  const stamp = Date.now();
  const expoToken = `ExponentPushToken[profile-${stamp}]`;

  const tick = async () => {
    const response = await fetch(`${BASE_URL}/api/workflows/proactive/tick`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      method: 'POST',
    });
    if (!response.ok) throw new Error(`tick: HTTP ${response.status} ${await response.text()}`);
    return (await response.json()) as { outcomes: Record<string, number> };
  };

  /** The model's chat requests whose latest user message is `text`. */
  const requestsAfter = (text: string) =>
    model.requests.filter(
      (request) =>
        request.path.endsWith('/chat/completions') &&
        textOf(request.messages.findLast((m) => m.role === 'user')?.content).trim() === text,
    );

  /** Waits until the conversation's run is over and Biber's last line matches `reply`. */
  const replied = async (topicId: string, reply: RegExp) =>
    waitFor(
      `Biber’s reply ${reply}`,
      async () => {
        const { lines, run } = await client.query<ChatHistory>('mobile', 'chat.history', {
          topicId,
        });
        const last = lines.findLast((line) => line.kind === 'assistant');
        return run === 'idle' && reply.test(last?.text ?? '') ? lines : undefined;
      },
      120_000,
    ).catch((error) => {
      const last = model.requests.findLast((request) => request.path.endsWith('/chat/completions'));
      const asked = last?.messages.findLast((message) => message.role === 'user')?.content;
      throw new Error(
        `${error}; the model last saw ${JSON.stringify(asked)?.slice(0, 200)} with ${last?.tools.length ?? 0} tools`,
      );
    });

  const say = async (topicId: string, text: string, reply: RegExp) => {
    await client.mutation('mobile', 'chat.send', { text, topicId });
    return replied(topicId, reply);
  };

  const profile = () => client.query<Profile>('mobile', 'profile.get');

  try {
    const email = `profile-${stamp}@biber.test`;
    await client.signUp(email, 'Smoke-pass-12345', 'Profile');
    const { rows } = await db.query('select id from users where email = $1', [email]);
    const userId: string = rows[0].id;
    await client.mutation('mobile', 'pushToken.register', {
      deviceId: `profile-${stamp}`,
      expoToken,
      locale: SAY.locale,
      platform: 'ios',
    });
    // Biber's own model has no key locally: run it on the fake model the server points at
    await client.query('lambda', 'agent.getBuiltinAgent', { slug: 'inbox' });
    await db.query(
      `update agents set provider = $1, model = $2 where user_id = $3 and slug = 'inbox'`,
      [
        process.env.SMOKE_MODEL_PROVIDER ?? 'openai',
        process.env.SMOKE_MODEL ?? 'gpt-4o-mini',
        userId,
      ],
    );

    await step('a new user is invited, and "Later" puts the invite away', async () => {
      const before = await client.query<{ invite: boolean }>('mobile', 'profile.status');
      if (!before.invite) throw new Error('no invite for a new user');
      await client.mutation('mobile', 'profile.dismissInvite');
      const after = await client.query<{ invite: boolean }>('mobile', 'profile.status');
      if (after.invite) throw new Error('the invite came back');
    });

    const topicId = await step(
      'the interview opens in its own conversation and Biber asks the name first',
      async () => {
        const started = await client.mutation<{ topicId: string }>(
          'mobile',
          'profile.startInterview',
          { locale: SAY.locale },
        );
        await replied(started.topicId, /What should I call you/);
        const [first] = requestsAfter(MAINLAND ? '我们开始吧' : 'Let’s start');
        const prompt = first && promptOf(first);
        if (!prompt?.includes('<profile_interview>') || !prompt.includes('Still to ask: name,')) {
          throw new Error(`the first call lacked the interview: ${prompt?.slice(0, 300)}`);
        }
        const { interview } = await profile();
        if (interview.topicId !== started.topicId) throw new Error(JSON.stringify(interview));
        return started.topicId;
      },
    );

    await step('each answer is saved with its number, and "enough" ends it', async () => {
      await say(topicId, SAY.name, /^Got it\. Saved name/);
      await say(topicId, SAY.goal, /^Got it\. Saved G0 \(goals\)/);
      await say(topicId, SAY.person, /^Got it\. Saved PE0 \(people\)/);
      await say(topicId, SAY.project, /^Got it\. Saved PR0 \(projects\)/);
      // Once the project is saved, the interview knows what is left
      const latest = requestsAfter(SAY.project).at(-1)!;
      if (!promptOf(latest).includes('Still to ask: mission, challenges, now, ideal, style.')) {
        throw new Error('the interview did not track what is left');
      }
      await say(topicId, SAY.done, /Here is what I saved/);

      const { entries, interview } = await profile();
      const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry.section]));
      if (byId.name !== 'name' || byId.G0 !== 'goals' || byId.PE0 !== 'people') {
        throw new Error(JSON.stringify(entries));
      }
      if (byId.PR0 !== 'projects' || !interview.finishedAt) {
        throw new Error(JSON.stringify({ entries, interview }));
      }
    });

    const chat = await step(
      'another conversation carries the profile, and none of the interview’s rules',
      async () => {
        const text = `Hello ${stamp}`;
        const { topicId: chatId } = await client.mutation<{ topicId: string }>(
          'mobile',
          'chat.send',
          { text },
        );
        await replied(chatId, /Hello from the fake model/);
        const prompt = promptOf(requestsAfter(text)[0]);
        const name = MAINLAND ? '[name] 小安' : '[name] An';
        if (!prompt.includes('<user_profile>') || !prompt.includes(name)) {
          throw new Error(`no profile: ${prompt.slice(0, 400)}`);
        }
        if (!prompt.includes('- [G0] ') || prompt.includes('<profile_interview>')) {
          throw new Error(`wrong profile block: ${prompt.slice(0, 400)}`);
        }
        return chatId;
      },
    );

    await step('a change and a deletion on the phone are what Biber reads next', async () => {
      await client.mutation('mobile', 'profile.saveEntry', {
        id: 'G0',
        section: 'goals',
        text: SAY.goalChanged,
      });
      await client.mutation('mobile', 'profile.dropEntry', { id: 'PE0' });

      const text = `Again ${stamp}`;
      await say(chat, text, /Hello from the fake model/);
      const prompt = promptOf(requestsAfter(text)[0]);
      if (!prompt.includes(`- [G0] ${SAY.goalChanged}`) || prompt.includes('[PE0]')) {
        throw new Error(`stale profile: ${prompt.slice(0, 500)}`);
      }
    });

    await step(
      'an entry out of date is asked about once, and "still holds" confirms it',
      async () => {
        // As if a month had passed since G0 was said, and the user last wrote a while ago
        await db.query(
          `update user_profiles set entries = (
           select jsonb_agg(case when e->>'id' = 'G0'
             then (e - 'reviewedAt') || jsonb_build_object('updatedAt', $2::text) else e end)
           from jsonb_array_elements(entries) e)
         where user_id = $1`,
          [userId, new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()],
        );
        await client.mutation('mobile', 'proactive.updateSettings', {
          level: 'standard',
          quietEnd: 0,
          quietStart: 0,
          timeZone: 'UTC',
        });
        await db.query(
          `update messages set created_at = now() - interval '30 minutes' where user_id = $1 and role = 'user'`,
          [userId],
        );
        const result = await tick();
        if (!result.outcomes.sent) throw new Error(JSON.stringify(result));
        const sent = await waitFor(
          'the profile check',
          async () =>
            push.sent.find(
              (pushed: PushRequest) => pushed.to === expoToken && pushed.data?.kind === 'proactive',
            ),
          10_000,
        );
        if (!sent.body.includes('[G0]') || !sent.body.includes(SAY.goalChanged)) {
          throw new Error(JSON.stringify(sent));
        }
        const { rows: ledger } = await db.query(
          `select kind, topic_id from proactive_messages where user_id = $1`,
          [userId],
        );
        if (ledger[0]?.kind !== 'profile_check') throw new Error(JSON.stringify(ledger));

        await say(ledger[0].topic_id, SAY.stillHolds, /noted that it still holds/);
        const goal = (await profile()).entries.find((entry) => entry.id === 'G0');
        if (!goal?.reviewedAt) throw new Error(JSON.stringify(goal));

        // A day on, nothing is asked again
        await db.query(
          `update proactive_settings set last_attempt_at = now() - interval '1 hour', last_sent_at = now() - interval '1 day' where user_id = $1`,
          [userId],
        );
        await db.query(
          `update messages set created_at = now() - interval '30 minutes' where user_id = $1 and role = 'user'`,
          [userId],
        );
        await tick();
        const checks = push.sent.filter(
          (pushed: PushRequest) => pushed.to === expoToken && pushed.data?.kind === 'proactive',
        );
        if (checks.length !== 1) throw new Error(`asked again: ${JSON.stringify(checks)}`);
      },
    );

    await step(
      'another account cannot read or change the profile, nor open the interview',
      async () => {
        const stranger = new SmokeClient(BASE_URL);
        await stranger.signUp(`profile-other-${stamp}@biber.test`, 'Smoke-pass-12345', 'Other');
        const theirs = await stranger.query<Profile>('mobile', 'profile.get');
        if (theirs.entries.length > 0) throw new Error(JSON.stringify(theirs));
        const dropped = await stranger
          .mutation('mobile', 'profile.dropEntry', { id: 'G0' })
          .then(() => 'dropped')
          .catch((error: Error) => error.message);
        if (!dropped.includes('PROFILE_NOT_FOUND')) throw new Error(dropped);
        const opened = await stranger
          .query('mobile', 'chat.history', { topicId })
          .then(() => 'opened')
          .catch((error: Error) => error.message);
        if (opened === 'opened') throw new Error('a stranger read the interview');
        if (!(await profile()).entries.some((entry) => entry.id === 'G0')) {
          throw new Error('G0 is gone');
        }
      },
    );
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
