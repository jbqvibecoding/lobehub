/**
 * The coding expert, against a running server, a real coding computer (agent-computer, started
 * here) running the real `lh hetero exec`, and stand-ins for Claude Code (fake-claude.mjs), the
 * model behind the coding gateway and GitHub:
 * - the phone connects GitHub: the callback keeps the installation for this user, with acme/demo;
 * - asked for a README, the coder opens acme/demo without any credential, asks to push, and waits
 *   for the phone; approved, the server makes a biber/… branch holding exactly the approved change
 *   and opens a pull request; the README comes back to the chat as a file;
 * - declined, nothing is pushed and the coder is told;
 * - a long run shows as running; its token works for its own run and the gateway only: the
 *   gateway charges the user and calls the model with the platform's key (the mainland edition
 *   reviews what is asked), while the phone's and the web app's endpoints and another run refuse
 *   it; the coding computer holds no installation token, platform key or App key; the stop button
 *   ends the run and its process;
 * - (mainland) a request the review flags never starts a run;
 * - in a group, the researcher and the coder answer the same message side by side, the coder's
 *   turns stamped as its own and the group's, and the coder later resumes its own session.
 *
 *   APP_REGION=cn SMOKE_DATABASE_URL=postgres://… SMOKE_MODEL_PROVIDER=deepseek \
 *   SMOKE_MODEL=deepseek-v4-flash bunx tsx scripts/biber/smoke/coding.ts
 *
 * The server needs what documents.ts needs (SANDBOX_PROVIDER=openbot,
 * OPENBOT_SUPERVISOR_URL=http://127.0.0.1:4300, OPENBOT_SUPERVISOR_TOKEN=smoke-supervisor,
 * OPENBOT_COMPUTER_TOKEN=smoke-computer, OPENBOT_COMPUTER_EGRESS=all, S3_ENDPOINT and
 * S3_ENABLE_PATH_STYLE=1), and for coding:
 *   CODING_BASE_URL=http://127.0.0.1:4140
 *   DEEPSEEK_API_KEY=smoke-platform-key (mainland) or ANTHROPIC_API_KEY=smoke-platform-key (global)
 *   GITHUB_API_URL=http://127.0.0.1:4150 GITHUB_WEB_URL=http://127.0.0.1:4150
 *   GITHUB_APP_ID=4242 GITHUB_APP_SLUG=biber-smoke GITHUB_APP_CLIENT_ID=Iv1.smoke
 *   GITHUB_APP_CLIENT_SECRET=smoke GITHUB_APP_PRIVATE_KEY="$(openssl genrsa 2048)"
 *   LOBEHUB_HETERO_SANDBOX_CWD=<this script's workspace, $TMPDIR/biber-coding-workspace by default>
 * Bun, Node and tar must be on the PATH: the computer runs `lh` from apps/cli with Bun.
 */
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import pg from 'pg';
import superjson from 'superjson';

import { SmokeClient, waitFor } from './client';
import {
  startFakeAnthropic,
  startFakeContentSafety,
  startFakeExpoPush,
  startFakeGithub,
  startFakeModel,
  startFakeS3,
  startFakeSupervisor,
} from './fake-services';
import { codingComputerIdForUser, startLocalComputer } from './local-computer';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const DATABASE_URL = process.env.SMOKE_DATABASE_URL ?? process.env.DATABASE_URL;
const SUPERVISOR_TOKEN = process.env.SMOKE_SUPERVISOR_TOKEN ?? 'smoke-supervisor';
const COMPUTER_SECRET = process.env.SMOKE_COMPUTER_TOKEN ?? 'smoke-computer';
const COMPUTER_PORT = Number(process.env.SMOKE_COMPUTER_PORT ?? 4100);
const PLATFORM_KEY = process.env.SMOKE_PLATFORM_KEY ?? 'smoke-platform-key';
const WORKSPACE =
  process.env.SMOKE_CODING_WORKSPACE ?? path.join(tmpdir(), 'biber-coding-workspace');
const MAINLAND = process.env.APP_REGION === 'cn';
const LOCALE = MAINLAND ? 'zh-CN' : 'en-US';
const CODER = MAINLAND ? '编程助手' : 'Coder';
const RESEARCHER = MAINLAND ? '研究员' : 'Researcher';
/** Where the fake claude writes what it was given, in its working directory */
const RUN_RECORD = path.join(WORKSPACE, '.biber-smoke-run.json');
const README = '# Demo\n\nWhat this project does.\n';

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

interface ChatLine {
  agentId?: string;
  apiName?: string;
  file?: { id: string; name: string; url: string };
  id: string;
  kind: string;
  status?: string;
  text?: string;
}

interface ChatHistory {
  lines: ChatLine[];
  run: 'idle' | 'running' | 'waiting';
}

interface Pending {
  apiName: string;
  arguments?: string;
  id: string;
  topicId: string | null;
}

interface RunRecord {
  args: string[];
  env: Record<string, string | undefined>;
}

/** Every file under a folder, as text, `.git` included: where a leaked secret could sit. */
const allFiles = async (dir: string): Promise<{ file: string; text: string }[]> => {
  const found: { file: string; text: string }[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await allFiles(file)));
    else if (entry.isFile() && (await stat(file)).size < 5_000_000) {
      found.push({ file, text: await readFile(file, 'latin1') });
    }
  }
  return found;
};

/** A tRPC call made with a run's token the way `lh` sends it, answered or refused. */
const callWithRunToken = async (
  token: string,
  router: 'lambda' | 'mobile',
  procedure: string,
  kind: 'mutation' | 'query',
  input: unknown,
) => {
  const encoded = JSON.stringify({ 0: superjson.serialize(input) });
  const url = `${BASE_URL}/trpc/${router}/${procedure}?batch=1`;
  const response = await fetch(
    kind === 'query' ? `${url}&input=${encodeURIComponent(encoded)}` : url,
    {
      body: kind === 'mutation' ? encoded : undefined,
      headers: { 'Content-Type': 'application/json', 'Oidc-Auth': token },
      method: kind === 'mutation' ? 'POST' : 'GET',
    },
  );
  const [result] = (await response.json().catch(() => [{ error: true }])) as any[];
  return { answered: response.ok && !result?.error, status: response.status };
};

const main = async () => {
  if (!DATABASE_URL) throw new Error('Set SMOKE_DATABASE_URL to the server’s database');
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const push = await startFakeExpoPush(Number(process.env.SMOKE_PUSH_PORT ?? 4020));
  const contentSafety = await startFakeContentSafety(
    Number(process.env.SMOKE_CONTENT_SAFETY_PORT ?? 4090),
  );
  const s3 = await startFakeS3(Number(process.env.SMOKE_S3_PORT ?? 4130));
  const anthropic = await startFakeAnthropic(Number(process.env.SMOKE_ANTHROPIC_PORT ?? 4140));
  const github = await startFakeGithub(Number(process.env.SMOKE_GITHUB_PORT ?? 4150));
  const supervisor = await startFakeSupervisor(Number(process.env.SMOKE_SUPERVISOR_PORT ?? 4300), {
    computerUrl: `http://127.0.0.1:${COMPUTER_PORT}`,
    token: SUPERVISOR_TOKEN,
  });

  // `lh` from this repository and the stand-in `claude`, first on the coding computer's PATH
  const bin = await mkdtemp(path.join(tmpdir(), 'biber-coding-bin-'));
  await writeFile(
    path.join(bin, 'lh'),
    `#!/bin/sh\nexec bun ${JSON.stringify(path.resolve('apps/cli/src/index.ts'))} "$@"\n`,
  );
  await writeFile(
    path.join(bin, 'claude'),
    `#!/bin/sh\nexec node ${JSON.stringify(path.resolve('scripts/biber/smoke/fake-claude.mjs'))} "$@"\n`,
  );
  await chmod(path.join(bin, 'lh'), 0o755);
  await chmod(path.join(bin, 'claude'), 0o755);
  await rm(WORKSPACE, { force: true, recursive: true });
  await mkdir(WORKSPACE, { recursive: true });

  let computer: Awaited<ReturnType<typeof startLocalComputer>> | undefined;
  const client = new SmokeClient(BASE_URL);
  const stamp = Date.now();

  const history = (topicId: string) =>
    client.query<ChatHistory>('mobile', 'chat.history', { topicId });

  const pendingPush = (topicId: string) =>
    waitFor('the push to wait for the phone', async () => {
      const pending = await client.query<Pending[]>('mobile', 'approval.listPending', {});
      return pending.find((item) => item.topicId === topicId && item.apiName === 'pushChanges');
    });

  /** Waits until the chat is idle with a reply matching `reply`. */
  const replied = (topicId: string, reply: RegExp, timeoutMs = 120_000) =>
    waitFor(
      `a reply matching ${reply}`,
      async () => {
        const chat = await history(topicId);
        const found = chat.lines.some(
          (line) => line.kind === 'assistant' && reply.test(line.text ?? ''),
        );
        return chat.run === 'idle' && found ? chat : undefined;
      },
      timeoutMs,
    ).catch(async (error) => {
      const { lines } = await history(topicId);
      const said = lines.map(
        (line) => `${line.kind}: ${(line.text ?? line.status ?? line.apiName ?? '').slice(0, 200)}`,
      );
      throw new Error(
        `${error}\nthe chat:\n${said.join('\n')}\nthe computer said:\n${computer?.output().slice(-3000)}`,
      );
    });

  /** The next run's record, once its fake claude has started. */
  const nextRun = async (send: () => Promise<unknown>) => {
    await rm(RUN_RECORD, { force: true });
    await send();
    return waitFor('the coding run to start', async () => {
      const raw = await readFile(RUN_RECORD, 'utf8').catch(() => undefined);
      return raw ? (JSON.parse(raw) as RunRecord) : undefined;
    });
  };

  const usedCredits = async (userId: string) => {
    const { rows } = await db.query(
      'select coalesce(sum(used_credits), 0)::bigint as n from user_credit_usages where user_id = $1',
      [userId],
    );
    return Number(rows[0].n);
  };

  try {
    const email = `coding-${stamp}@biber.test`;
    await client.signUp(email, 'Smoke-pass-12345', 'Coding');
    const { rows } = await db.query('select id from users where email = $1', [email]);
    const userId: string = rows[0].id;
    computer = await startLocalComputer({
      computerId: codingComputerIdForUser(userId),
      env: { PATH: `${bin}:${process.env.PATH}` },
      port: COMPUTER_PORT,
      secret: COMPUTER_SECRET,
      workspace: WORKSPACE,
    });

    await step(
      'the phone connects GitHub, and the installation is kept for this user',
      async () => {
        const { url } = await client.mutation<{ url: string }>('mobile', 'github.connectUrl');
        const state = new URL(url).searchParams.get('state');
        if (!state || !url.includes('/installations/new')) throw new Error(url);
        // GitHub sends the browser back with the installation and an OAuth code
        const back = await fetch(
          `${BASE_URL}/api/github/callback?code=smoke-code&installation_id=77&setup_action=install&state=${state}`,
        );
        if (!back.ok || !(await back.text()).includes('acme')) {
          throw new Error(`callback: HTTP ${back.status}`);
        }
        const status = await client.query<{ login?: string; repositories?: string[] }>(
          'mobile',
          'github.status',
        );
        if (status.login !== 'acme' || status.repositories?.join() !== 'acme/demo') {
          throw new Error(JSON.stringify(status));
        }
      },
    );

    const coder = await step('the phone adds the coder, which runs as Claude Code', async () => {
      const { agentId } = await client.mutation<{ agentId: string }>('mobile', 'experts.add', {
        id: 'coder',
        locale: LOCALE,
      });
      const { rows: agent } = await db.query('select agency_config from agents where id = $1', [
        agentId,
      ]);
      if (agent[0]?.agency_config?.heterogeneousProvider?.type !== 'claude-code') {
        throw new Error(JSON.stringify(agent[0]));
      }
      return agentId;
    });

    const topicId = await step(
      'asked for a README, it pushes only once the phone approves, exactly what was approved',
      async () => {
        const creditsBefore = await usedCredits(userId);
        const { topicId } = await client.mutation<{ topicId: string }>('mobile', 'chat.send', {
          agentId: coder,
          text: MAINLAND ? '给 demo 仓库加一个 README' : 'Add a README to the demo repository',
        });
        const request = await pendingPush(topicId);
        const shown = request.arguments ?? '';
        if (!shown.includes('acme/demo') || !shown.includes('README.md')) {
          throw new Error(`the card shows ${shown}`);
        }
        if (github.pushes.length > 0) throw new Error('pushed before the phone answered');

        await client.mutation('mobile', 'approval.respond', {
          decision: 'approved',
          toolMessageId: request.id,
        });
        const chat = await replied(topicId, /Pushed\./);

        const [pushed] = github.pushes;
        if (!pushed?.branch.startsWith('biber/') || pushed.pullRequest?.base !== 'main') {
          throw new Error(JSON.stringify(pushed));
        }
        if (JSON.stringify(pushed.files) !== JSON.stringify({ 'README.md': README })) {
          throw new Error(`the commit holds ${JSON.stringify(pushed.files)}`);
        }
        const reply = chat.lines.findLast((line) => line.kind === 'assistant')?.text ?? '';
        if (!reply.includes('/acme/demo/pull/1')) throw new Error(`the reply: ${reply}`);
        if (!chat.lines.some((line) => line.file?.name === 'README.md')) {
          throw new Error('no file card for README.md');
        }
        // The gateway called the model with the platform's key, on the configured model, and
        // charged the user for it
        const calls = anthropic.calls.filter((call) => /readme/i.test(call.text));
        if (calls.length === 0) throw new Error('the model was never called');
        if (
          calls.some((call) => call.apiKey !== PLATFORM_KEY || call.model === 'claude-sonnet-fake')
        ) {
          throw new Error(
            JSON.stringify(
              calls.map(({ apiKey, model }) => ({ apiKey: apiKey.slice(0, 6), model })),
            ),
          );
        }
        if ((await usedCredits(userId)) <= creditsBefore) throw new Error('nothing was charged');
        return topicId;
      },
    );

    await step('declined, nothing is pushed and the coder is told', async () => {
      const writes = github.calls.filter((call) => call.method === 'POST').length;
      await client.mutation('mobile', 'chat.send', {
        text: MAINLAND ? '再加一个 README' : 'Add the README again',
        topicId,
      });
      const request = await pendingPush(topicId);
      await client.mutation('mobile', 'approval.respond', {
        decision: 'rejected',
        reason: 'Not now',
        toolMessageId: request.id,
      });
      await replied(topicId, /Not pushed\./);
      const after = github.calls.filter(
        (call) => call.method === 'POST' && call.path.startsWith('/repos/'),
      );
      if (github.pushes.length !== 1 || after.length > writes) {
        throw new Error(`GitHub was written to: ${JSON.stringify(after.slice(-3))}`);
      }
    });

    const longRun = await step('a long run shows as running', async () => {
      const run = await nextRun(() =>
        client.mutation('mobile', 'chat.send', {
          text: MAINLAND
            ? '慢慢来，把整个项目重构一遍'
            : 'Take your time and refactor the whole project',
          topicId,
        }),
      );
      await waitFor('the chat to show the run', async () =>
        (await history(topicId)).run === 'running' ? true : undefined,
      );
      return run;
    });

    await step(
      'the coding computer holds no installation token, platform key or App key',
      async () => {
        const token = longRun.env.LOBEHUB_JWT;
        if (!token || longRun.env.ANTHROPIC_API_KEY !== token) {
          throw new Error('the run was not given its own token for the model');
        }
        const secrets = [PLATFORM_KEY, ...github.tokens, 'PRIVATE KEY', 'client_secret'];
        for (const { file, text } of await allFiles(WORKSPACE)) {
          const leaked = secrets.find((secret) => text.includes(secret));
          if (leaked) throw new Error(`${file} holds ${leaked.slice(0, 12)}…`);
        }
        const named = Object.keys(longRun.env).filter((name) =>
          /^(?:DEEPSEEK|OPENAI|GITHUB|GH|KEY_VAULTS|AUTH|DATABASE|OPENBOT)_/.test(name),
        );
        if (named.length > 0) throw new Error(`the run sees ${named.join(', ')}`);
      },
    );

    await step('its token reaches the gateway and its own run only', async () => {
      const token = longRun.env.LOBEHUB_JWT!;
      const elsewhere = [
        await callWithRunToken(token, 'lambda', 'user.getUserState', 'query', null),
        await callWithRunToken(token, 'mobile', 'chat.history', 'query', { topicId }),
        await callWithRunToken(token, 'lambda', 'aiAgent.heteroIngest', 'mutation', {
          agentType: 'claude-code',
          events: [
            {
              data: { chunkType: 'text', content: 'not mine' },
              operationId: 'op-not-mine',
              stepIndex: 0,
              timestamp: Date.now(),
              type: 'stream_chunk',
            },
          ],
          operationId: 'op-not-mine',
          topicId,
        }),
      ];
      if (elsewhere.some((call) => call.answered)) {
        throw new Error(`answered: ${JSON.stringify(elsewhere)}`);
      }

      const ask = (text: string) =>
        fetch(`${BASE_URL}/api/coding/anthropic/v1/messages`, {
          body: JSON.stringify({
            max_tokens: 16,
            messages: [{ content: text, role: 'user' }],
            model: 'claude-sonnet-fake',
          }),
          headers: { 'content-type': 'application/json', 'x-api-key': token },
          method: 'POST',
        });
      const before = anthropic.calls.length;
      const plain = await ask('How long is a day?');
      if (!plain.ok) throw new Error(`the gateway: HTTP ${plain.status} ${await plain.text()}`);
      if (anthropic.calls.at(-1)?.apiKey !== PLATFORM_KEY) throw new Error('not the platform key');
      if (MAINLAND) {
        const flagged = await ask('BLOCKME please');
        if (flagged.ok) throw new Error('the review let a flagged request through');
        if (anthropic.calls.length !== before + 1)
          throw new Error('the flagged request reached the model');
      }
    });

    await step('the stop button ends the run and its process', async () => {
      const { stopped } = await client.mutation<{ stopped: boolean }>('mobile', 'chat.stop', {
        topicId,
      });
      if (!stopped) throw new Error('not stopped');
      await waitFor('the chat to be idle', async () =>
        (await history(topicId)).run === 'idle' ? true : undefined,
      );
      const operationId = JSON.parse(
        Buffer.from(longRun.env.LOBEHUB_JWT!.split('.')[1], 'base64url').toString(),
      ).op as string;
      const { rows: op } = await db.query('select status from agent_operations where id = $1', [
        operationId,
      ]);
      if (op[0]?.status !== 'interrupted') throw new Error(JSON.stringify(op[0]));
      await waitFor('the run’s process to end', async () => {
        try {
          execFileSync('pgrep', ['-f', 'fake-claude.mjs']);
          return undefined;
        } catch {
          return true;
        }
      });
    });

    if (MAINLAND) {
      await step('a request the review flags never starts a run', async () => {
        await rm(RUN_RECORD, { force: true });
        await client
          .mutation('mobile', 'chat.send', { text: 'BLOCKME README', topicId })
          .catch(() => undefined);
        await new Promise((done) => setTimeout(done, 8000));
        const started = await readFile(RUN_RECORD, 'utf8').catch(() => undefined);
        if (started) throw new Error('a run started');
      });
    }

    await step(
      'in a group the researcher and the coder answer together, the coder in its own name',
      async () => {
        const { agentId: researcher } = await client.mutation<{ agentId: string }>(
          'mobile',
          'experts.add',
          { id: 'researcher', locale: LOCALE },
        );
        const { groupId } = await client.mutation<{ groupId: string }>(
          'mobile',
          'chat.startGroup',
          {
            expertIds: [researcher, coder],
            locale: LOCALE,
          },
        );
        // Biber (made with the group if it was not yet) and the researcher run on the fake model;
        // the coder stays Claude Code
        await db.query(
          `update agents set provider = $1, model = $2
            where user_id = $3 and (agency_config -> 'heterogeneousProvider') is null`,
          [
            process.env.SMOKE_MODEL_PROVIDER ?? 'openai',
            process.env.SMOKE_MODEL ?? 'gpt-4o-mini',
            userId,
          ],
        );
        const { topicId: groupTopic } = await client.mutation<{ topicId: string }>(
          'mobile',
          'chat.send',
          {
            groupId,
            mentions: [researcher, coder],
            text: `@${RESEARCHER} @${CODER} ${MAINLAND ? '这个项目值得做吗' : 'is this project worth doing?'}`,
          },
        );
        const chat = await waitFor(
          'both answers',
          async () => {
            const read = await history(groupTopic);
            const from = (agentId: string, opening: string) =>
              read.lines.some(
                (line) =>
                  line.kind === 'assistant' &&
                  line.agentId === agentId &&
                  line.text?.startsWith(opening),
              );
            return read.run === 'idle' &&
              from(researcher, 'Researcher here') &&
              from(coder, 'Coder here:')
              ? read
              : undefined;
          },
          180_000,
        ).catch(async (error) => {
          const { lines } = await history(groupTopic);
          throw new Error(
            `${error}\n${lines.map((line) => `${line.kind} ${line.agentId}: ${line.text?.slice(0, 80)}`).join('\n')}`,
          );
        });
        const { rows: coderTurns } = await db.query(
          `select count(*)::int as n from messages
            where topic_id = $1 and agent_id = $2 and group_id = $3 and role = 'assistant'`,
          [groupTopic, coder, groupId],
        );
        if (coderTurns[0].n < 2)
          throw new Error(`${coderTurns[0].n} of the coder's turns in the group`);
        const { rows: topic } = await db.query('select metadata from topics where id = $1', [
          groupTopic,
        ]);
        const session = topic[0]?.metadata?.heteroSessions?.[coder];
        if (!session)
          throw new Error(`no session of the coder: ${JSON.stringify(topic[0]?.metadata)}`);
        if (Object.keys(topic[0].metadata.heteroMemberRuns ?? {}).length > 0) {
          throw new Error('a finished member run is still recorded');
        }

        // Asked again, the coder resumes its own session
        const again = await nextRun(() =>
          client.mutation('mobile', 'chat.send', {
            groupId,
            mentions: [coder],
            text: `@${CODER} ${MAINLAND ? '再说一点' : 'and one more thing'}`,
            topicId: groupTopic,
          }),
        );
        const resumed = again.args[again.args.indexOf('--resume') + 1];
        if (resumed !== session) throw new Error(`resumed ${resumed}, not ${session}`);
        await waitFor('the second answer', async () => {
          const read = await history(groupTopic);
          const answers = read.lines.filter(
            (line) => line.agentId === coder && line.text?.startsWith('Coder here:'),
          );
          return read.run === 'idle' && answers.length >= 2 ? true : undefined;
        });
        return chat;
      },
    );
  } finally {
    await computer?.stop();
    model.close();
    push.close();
    contentSafety.close();
    s3.close();
    anthropic.close();
    github.close();
    supervisor.close();
    await rm(bin, { force: true, recursive: true });
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
