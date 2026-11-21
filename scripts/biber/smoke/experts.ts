/**
 * The user's experts and the group chats Biber hosts with them, against a running server, through
 * the phone's routes and the web's group route:
 * - experts are added to the team once, however often the user taps Add;
 * - a group chat is hosted by Biber itself, with no stand-in host created;
 * - "@Researcher …" goes to the researcher alone, Biber stays out of it;
 * - without a mention, Biber hands "ask the researcher …" over with `speak`, and the researcher
 *   answers in the group, under their own name;
 * - deleting a group leaves Biber and the experts in place;
 * - removing an expert deletes the chats with them;
 * - another account can neither see nor write in the group, nor build one from someone's experts.
 *
 *   SMOKE_DATABASE_URL=postgres://… bunx tsx scripts/biber/smoke/experts.ts
 *
 * The server needs the fake model (OPENAI_PROXY_URL, or the DeepSeek proxy on the mainland edition,
 * pointing at http://127.0.0.1:4010/v1), plus ALIYUN_GREEN_ENDPOINT=http://127.0.0.1:4090 on the
 * mainland edition. Run it there with APP_REGION=cn, SMOKE_MODEL_PROVIDER=deepseek and
 * SMOKE_MODEL=deepseek-v4-flash; the experts are then added in Chinese.
 */
import pg from 'pg';

import { SmokeClient, waitFor } from './client';
import { SPEAK_TOOL, startFakeContentSafety, startFakeModel } from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const DATABASE_URL = process.env.SMOKE_DATABASE_URL ?? process.env.DATABASE_URL;
const MAINLAND = process.env.APP_REGION === 'cn';
const LOCALE = MAINLAND ? 'zh-CN' : 'en-US';
const RESEARCHER = MAINLAND ? '研究员' : 'Researcher';

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

interface Expert {
  agentId: string | null;
  id: string;
  title: string;
}

interface Member {
  id: string;
  isHost: boolean;
  title: string;
}

interface ChatHistory {
  /** In a one-on-one chat: who it is with */
  agentId?: string;
  lines: { agentId?: string; id: string; kind: string; text?: string }[];
  run: 'idle' | 'running' | 'waiting';
  speakers: Record<string, { title: string }>;
}

/** Fails unless `run` is refused. */
const refused = async (what: string, run: () => Promise<unknown>) => {
  try {
    await run();
  } catch {
    return;
  }
  throw new Error(`${what} went through`);
};

const main = async () => {
  if (!DATABASE_URL) throw new Error('Set SMOKE_DATABASE_URL to the server’s database');
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const contentSafety = await startFakeContentSafety(
    Number(process.env.SMOKE_CONTENT_SAFETY_PORT ?? 4090),
  );
  const client = new SmokeClient(BASE_URL);
  const stamp = Date.now();

  /**
   * Waits until the run is over and `agentId` has answered the user's last message with a reply
   * starting `opening` (the fake model's words for that expert); returns all answers to it.
   */
  const answered = async (topicId: string, agentId: string, opening: string) =>
    waitFor(
      `${opening} …`,
      async () => {
        const history = await client.query<ChatHistory>('mobile', 'chat.history', { topicId });
        const lastUser = history.lines.findLastIndex((line) => line.kind === 'user');
        const answers = history.lines.slice(lastUser + 1).filter((l) => l.kind === 'assistant');
        const replied = answers.some(
          (line) => (line.agentId ?? history.agentId) === agentId && line.text?.startsWith(opening),
        );
        return history.run === 'idle' && replied ? { answers, history } : undefined;
      },
      120_000,
    ).catch((error) => {
      const last = model.requests.findLast((request) => request.path.endsWith('/chat/completions'));
      const asked = last?.messages.findLast((message) => message.role === 'user')?.content;
      throw new Error(
        `${error}; the model last saw ${JSON.stringify(asked)?.slice(0, 300)} with tools [${last?.tools.join(', ')}] (${model.requests.length} requests)`,
      );
    });

  try {
    const email = `experts-${stamp}@biber.test`;
    await client.signUp(email, 'Smoke-pass-12345', 'Experts');
    const { rows } = await db.query('select id from users where email = $1', [email]);
    const userId: string = rows[0].id;
    const biber = await client.query<{ id: string }>('lambda', 'agent.getBuiltinAgent', {
      slug: 'inbox',
    });
    /** Every agent of the user runs on the fake model the server points at. */
    const useFakeModel = () =>
      db.query(`update agents set provider = $1, model = $2 where user_id = $3`, [
        process.env.SMOKE_MODEL_PROVIDER ?? 'openai',
        process.env.SMOKE_MODEL ?? 'gpt-4o-mini',
        userId,
      ]);

    const { researcher, writer } = await step(
      'experts join the team once, however often Add is tapped',
      async () => {
        const first = await client.mutation<{ agentId: string; created: boolean }>(
          'mobile',
          'experts.add',
          { id: 'researcher', locale: LOCALE },
        );
        const again = await client.mutation<{ agentId: string; created: boolean }>(
          'mobile',
          'experts.add',
          { id: 'researcher', locale: LOCALE },
        );
        const added = await client.mutation<{ agentId: string }>('mobile', 'experts.add', {
          id: 'writer',
          locale: LOCALE,
        });
        if (!first.created || again.created || again.agentId !== first.agentId) {
          throw new Error(JSON.stringify({ again, first }));
        }
        const { rows: copies } = await db.query(
          `select count(*)::int as n from agents where user_id = $1 and market_identifier = 'biber-expert:researcher'`,
          [userId],
        );
        if (copies[0].n !== 1) throw new Error(`${copies[0].n} researchers`);

        const listed = await client.query<Expert[]>('mobile', 'experts.list', { locale: LOCALE });
        const shown = listed.find((expert) => expert.id === 'researcher');
        if (shown?.agentId !== first.agentId || shown.title !== RESEARCHER) {
          throw new Error(JSON.stringify(shown));
        }
        await useFakeModel();
        return { researcher: first.agentId, writer: added.agentId };
      },
    );

    const groupId = await step('Biber hosts the group chat, no stand-in host made', async () => {
      const before = await db.query('select count(*)::int as n from agents where user_id = $1', [
        userId,
      ]);
      const { groupId } = await client.mutation<{ groupId: string }>('mobile', 'chat.startGroup', {
        expertIds: [researcher, writer],
        locale: LOCALE,
      });
      const { members } = await client.query<{ members: Member[] }>('mobile', 'chat.group', {
        groupId,
      });
      if (members[0]?.id !== biber.id || !members[0].isHost || members.length !== 3) {
        throw new Error(JSON.stringify(members));
      }
      const after = await db.query('select count(*)::int as n from agents where user_id = $1', [
        userId,
      ]);
      if (after.rows[0].n !== before.rows[0].n) throw new Error('a host agent was created');
      return groupId;
    });

    const topicId = await step(`“@${RESEARCHER} …” goes to the researcher alone`, async () => {
      const { topicId } = await client.mutation<{ topicId: string }>('mobile', 'chat.send', {
        groupId,
        mentions: [researcher],
        text: `@${RESEARCHER} find sources on sleep and memory`,
      });
      const { answers, history } = await answered(topicId, researcher, 'Researcher here');
      if (answers.some((line) => line.agentId !== researcher)) {
        throw new Error(`others answered: ${JSON.stringify(answers)}`);
      }
      if (history.speakers[researcher]?.title !== RESEARCHER) {
        throw new Error(JSON.stringify(history.speakers));
      }
      // The researcher could search and read the web, and do nothing else
      const asResearcher = model.requests.filter((request) =>
        request.messages.some(
          (message) =>
            message.role === 'system' && String(message.content).includes('You are Researcher,'),
        ),
      );
      const tools = new Set(asResearcher.flatMap((request) => request.tools));
      if (asResearcher.length === 0 || tools.size === 0) {
        throw new Error('the researcher was given no tools');
      }
      if ([...tools].some((tool) => !tool.startsWith('lobe-web-browsing____'))) {
        throw new Error(`the researcher could use ${[...tools].join(', ')}`);
      }
      return topicId;
    });

    await step('without a mention Biber hands it to the researcher with speak', async () => {
      const asking = model.requests.length;
      await client.mutation('mobile', 'chat.send', {
        text: MAINLAND ? '请研究员查一下午睡的研究' : 'Ask the researcher what is known about naps',
        topicId,
      });
      await answered(topicId, researcher, 'Researcher here');
      const hosted = model.requests
        .slice(asking)
        .some((request) => request.tools.includes(SPEAK_TOOL));
      if (!hosted) throw new Error('Biber was never offered speak');
      const { rows: calls } = await db.query(
        `select p.api_name from message_plugins p join messages m on m.id = p.id
          where m.topic_id = $1 and p.identifier = 'lobe-group-management'`,
        [topicId],
      );
      if (!calls.some((call) => call.api_name === 'speak')) throw new Error(JSON.stringify(calls));
    });

    await step('another account can neither see nor write in the group', async () => {
      const stranger = new SmokeClient(BASE_URL);
      await stranger.signUp(`experts-other-${stamp}@biber.test`, 'Smoke-pass-12345', 'Other');
      await refused('reading the members', () =>
        stranger.query('mobile', 'chat.group', { groupId }),
      );
      await refused('reading the chat', () =>
        stranger.query('mobile', 'chat.history', { topicId }),
      );
      await refused('writing in the group', () =>
        stranger.mutation('mobile', 'chat.send', { groupId, text: 'hello' }),
      );
      await refused('building a group from someone else’s experts', () =>
        stranger.mutation('mobile', 'chat.startGroup', { expertIds: [researcher] }),
      );
      const { rows: theirs } = await db.query(
        `select count(*)::int as n from messages where topic_id = $1 and role = 'user'`,
        [topicId],
      );
      if (theirs[0].n !== 2) throw new Error(`${theirs[0].n} messages from the user`);
    });

    await step('deleting the group leaves Biber and the experts', async () => {
      await client.mutation('lambda', 'group.deleteGroup', { id: groupId });
      const { rows: left } = await db.query(
        'select id from agents where user_id = $1 and id = any($2)',
        [userId, [biber.id, researcher, writer]],
      );
      if (left.length !== 3) throw new Error(`only ${JSON.stringify(left)} are left`);
      const { rows: groups } = await db.query('select id from chat_groups where id = $1', [
        groupId,
      ]);
      if (groups.length > 0) throw new Error('the group is still there');
    });

    await step('removing an expert deletes the chats with them', async () => {
      const { topicId: chat } = await client.mutation<{ topicId: string }>('mobile', 'chat.send', {
        agentId: writer,
        text: 'Draft a post about our launch',
      });
      const { history } = await answered(chat, writer, 'Writer here');
      if (history.agentId !== writer) {
        throw new Error('the chat does not say who it is with');
      }

      await client.mutation('mobile', 'experts.remove', { id: 'writer' });
      const { rows: agentsLeft } = await db.query('select id from agents where id = $1', [writer]);
      const { rows: topicsLeft } = await db.query('select id from topics where id = $1', [chat]);
      if (agentsLeft.length > 0 || topicsLeft.length > 0) {
        throw new Error(JSON.stringify({ agentsLeft, topicsLeft }));
      }
      const listed = await client.query<Expert[]>('mobile', 'experts.list', { locale: LOCALE });
      if (listed.find((expert) => expert.id === 'writer')?.agentId) {
        throw new Error('the writer is still on the team');
      }
    });
  } finally {
    model.close();
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
