/**
 * Things Biber notes in a chat to bring up later, against a running server, through the phone's
 * routes, the web chat's route and the scheduled check:
 * - "Remind me to call mom": Biber notes it, and the phone lists it as one the user asked for;
 * - at its time it goes out, even with Biber turned off and inside quiet hours;
 * - "my interview is on Friday": Biber notes a follow-up of its own, which waits for its time;
 * - once due, the check brings it up like any other unprompted message;
 * - a note removed on the phone is gone for the agent (and the web chat) too;
 * - another account can neither see nor cancel them.
 *
 *   SMOKE_DATABASE_URL=postgres://… SMOKE_CRON_SECRET=… bunx tsx scripts/biber/smoke/reminders.ts
 *
 * The server needs what proactive.ts needs: CRON_SECRET, the fake model and
 * EXPO_BASE_URL=http://127.0.0.1:4020, plus ALIYUN_GREEN_ENDPOINT=http://127.0.0.1:4090 on the
 * mainland edition (run the script with APP_REGION=cn, SMOKE_MODEL_PROVIDER=deepseek and
 * SMOKE_MODEL=deepseek-v4-flash there: the model bank knows deepseek-chat only from other providers,
 * the first with a 32k window, and at that size the first message already compresses the chat).
 * The script moves times in the database instead of waiting.
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
  seed: string;
  source: string;
}

interface ToolAnswer {
  content: string;
  success: boolean;
}

interface ChatHistory {
  lines: { kind: string; text?: string }[];
  run: 'idle' | 'running' | 'waiting';
}

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
  const expoToken = `ExponentPushToken[reminders-${stamp}]`;

  const tick = async () => {
    const response = await fetch(`${BASE_URL}/api/workflows/proactive/tick`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      method: 'POST',
    });
    if (!response.ok) throw new Error(`tick: HTTP ${response.status} ${await response.text()}`);
    return (await response.json()) as {
      asked: Record<string, number>;
      outcomes: Record<string, number>;
    };
  };
  const pushesTo = (kind: string) =>
    push.sent.filter((sent: PushRequest) => sent.to === expoToken && sent.data?.kind === kind);

  /** Sends a chat message to Biber from the phone and waits until it has noted it. */
  const say = async (text: string) => {
    const { topicId } = await client.mutation<{ topicId: string }>('mobile', 'chat.send', { text });
    await waitFor(
      'Biber’s reply',
      async () => {
        const { lines, run } = await client.query<ChatHistory>('mobile', 'chat.history', {
          topicId,
        });
        // The fake model says this once the reminders tool has answered
        const replied = lines.some(
          (line) => line.kind === 'assistant' && /Noted, I will bring it up/.test(line.text ?? ''),
        );
        return run === 'idle' && replied ? true : undefined;
      },
      120_000,
    ).catch((error) => {
      // What the model was last asked, to tell a missing tool from an unrecognised request
      const last = model.requests.findLast((request) => request.path.endsWith('/chat/completions'));
      const asked = last?.messages.findLast((message) => message.role === 'user')?.content;
      throw new Error(
        `${error}; the model last saw ${JSON.stringify(asked)?.slice(0, 300)} with ${last?.tools.length ?? 0} tools${last?.tools.some((tool) => tool.includes('reminders')) ? ' (reminders among them)' : ', none of them reminders'}`,
      );
    });
  };
  const noteAbout = async (userId: string, seed: string) =>
    (
      await db.query(
        'select id, kind, source, status, due_at from proactive_thoughts where user_id = $1 and seed = $2',
        [userId, seed],
      )
    ).rows[0];
  /** As if time had passed: the note is due, and the user last wrote a while ago. */
  const fastForward = async (userId: string, noteId: string) => {
    await db.query(
      `update proactive_thoughts set due_at = now() - interval '1 minute' where id = $1`,
      [noteId],
    );
    await db.query(
      `update messages set created_at = now() - interval '30 minutes' where user_id = $1 and role = 'user'`,
      [userId],
    );
    await db.query(
      `update proactive_settings set last_attempt_at = now() - interval '1 hour' where user_id = $1`,
      [userId],
    );
  };

  try {
    const email = `reminders-${stamp}@biber.test`;
    await client.signUp(email, 'Smoke-pass-12345', 'Reminders');
    const { rows } = await db.query('select id from users where email = $1', [email]);
    const userId: string = rows[0].id;
    await client.mutation('mobile', 'pushToken.register', {
      deviceId: `reminders-${stamp}`,
      expoToken,
      locale: 'en-US',
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

    const mom = await step(
      '“Remind me to call mom” is noted as a reminder the user asked for',
      async () => {
        await say('Remind me to call mom');
        const note = await noteAbout(userId, 'call mom');
        if (note?.source !== 'asked' || note.status !== 'open') {
          const seen = model.requests.map(
            (request) => `${request.path} [${request.tools.join(', ')}]`,
          );
          throw new Error(
            `no asked note (${JSON.stringify(note)}); the model saw:\n${seen.join('\n')}`,
          );
        }

        const thoughts = await client.query<Thought[]>('mobile', 'proactive.listThoughts');
        if (!thoughts.some((thought) => thought.id === note.id && thought.source === 'asked')) {
          throw new Error(`not on the phone’s list: ${JSON.stringify(thoughts)}`);
        }
        return note;
      },
    );

    await step('at its time it goes out, even with Biber off and inside quiet hours', async () => {
      const hour = new Date().getUTCHours();
      await client.mutation('mobile', 'proactive.updateSettings', {
        level: 'off',
        quietEnd: (hour + 1) % 24,
        quietStart: hour,
        timeZone: 'UTC',
      });
      await fastForward(userId, mom.id);
      const result = await tick();
      if (!result.asked.sent) throw new Error(JSON.stringify(result));

      const sent = await waitFor('the push', async () => pushesTo('proactive')[0], 10_000);
      if (sent.body !== 'Reminder: call mom' || sent.categoryId !== 'proactive') {
        throw new Error(JSON.stringify(sent));
      }
      const { rows: ledger } = await db.query(
        `select kind, topic_id from proactive_messages where user_id = $1`,
        [userId],
      );
      if (ledger[0]?.kind !== 'asked') throw new Error(JSON.stringify(ledger));
      const { rows: chat } = await db.query(
        `select m.content, t.title from messages m join topics t on t.id = m.topic_id where m.topic_id = $1`,
        [ledger[0].topic_id],
      );
      if (chat[0]?.title !== 'From Biber' || chat[0].content !== 'Reminder: call mom') {
        throw new Error(JSON.stringify(chat));
      }
      const checked = contentSafety.checks.some(
        (check) => check.service === 'llm_response_moderation' && check.content === sent.body,
      );
      if (MAINLAND && !checked) throw new Error('the reminder skipped content moderation');
    });

    const interview = await step(
      'Biber notes a follow-up of its own, which waits for its time',
      async () => {
        await client.mutation('mobile', 'proactive.updateSettings', {
          level: 'standard',
          quietEnd: 0,
          quietStart: 0,
        });
        await say('By the way, my interview is on Friday');
        const note = await noteAbout(userId, 'The job interview');
        if (note?.source !== 'agent' || note.kind !== 'follow_up')
          throw new Error(JSON.stringify(note));
        if (new Date(note.due_at).getTime() < Date.now() + 20 * 60 * 60 * 1000) {
          throw new Error(`due too soon: ${note.due_at}`);
        }

        await db.query(
          `update messages set created_at = now() - interval '30 minutes' where user_id = $1 and role = 'user'`,
          [userId],
        );
        await tick();
        if (pushesTo('proactive').length !== 1) throw new Error('it was said before its time');
        return note;
      },
    );

    await step('once it is due, the check brings it up', async () => {
      await fastForward(userId, interview.id);
      const result = await tick();
      if (!result.outcomes.sent) throw new Error(JSON.stringify(result));
      const sent = await waitFor('the follow-up', async () => pushesTo('proactive')[1], 10_000);
      if (!sent.body.includes('The job interview')) throw new Error(JSON.stringify(sent));
      if ((await noteAbout(userId, 'The job interview')).status !== 'done') {
        throw new Error('the follow-up is still open');
      }
    });

    const plants = await step('a note removed on the phone is gone for the agent too', async () => {
      await say('Remind me to water the plants');
      const note = await noteAbout(userId, 'water the plants');
      const { dropped } = await client.mutation<{ dropped: boolean }>(
        'mobile',
        'proactive.dropThought',
        { id: note.id },
      );
      if (!dropped) throw new Error('not dropped');
      // The web chat's route answers what the agent sees
      const listed = await client.query<ToolAnswer>('lambda', 'reminders.list', {
        timeZone: 'UTC',
      });
      if (listed.content.includes('water the plants')) throw new Error(listed.content);
      return note;
    });

    await step('another account can neither see nor cancel them', async () => {
      await say('Remind me to book the car service');
      const note = await noteAbout(userId, 'book the car service');

      const stranger = new SmokeClient(BASE_URL);
      await stranger.signUp(`reminders-other-${stamp}@biber.test`, 'Smoke-pass-12345', 'Other');
      const listed = await stranger.query<ToolAnswer>('lambda', 'reminders.list', {});
      if (listed.content.includes('car service') || listed.content.includes(plants.id)) {
        throw new Error(listed.content);
      }
      const cancelled = await stranger.mutation<ToolAnswer>('lambda', 'reminders.cancel', {
        id: note.id,
      });
      const { dropped } = await stranger.mutation<{ dropped: boolean }>(
        'mobile',
        'proactive.dropThought',
        { id: note.id },
      );
      if (cancelled.success || dropped) throw new Error('a stranger removed it');
      if ((await noteAbout(userId, 'book the car service')).status !== 'open') {
        throw new Error('the note is gone');
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
