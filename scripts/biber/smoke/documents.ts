/**
 * The document maker, against a running server and a real cloud computer (agent-computer, started
 * here, with the document libraries of apps/computer/office on NODE_PATH):
 * - the phone adds the document maker, which gets the cloud sandbox;
 * - "make a three-slide deck": it writes the deck with pptxgenjs, exports it, the export is checked,
 *   the chat shows it as a file, and the file downloaded from the link is a PPTX with three slides;
 * - an empty file it tries to export is refused before upload, and it is told why;
 * - a reply naming report.xlsx that was never made gets one delivery check, and the follow-up
 *   makes and hands over the workbook; the follow-up is not checked again;
 * - another account cannot read the chat.
 *
 *   APP_REGION=cn SMOKE_DATABASE_URL=postgres://… SMOKE_MODEL_PROVIDER=deepseek \
 *   SMOKE_MODEL=deepseek-v4-flash bunx tsx scripts/biber/smoke/documents.ts
 *
 * The server needs what saved-logins.ts needs for the cloud computer (SANDBOX_PROVIDER=openbot,
 * OPENBOT_SUPERVISOR_URL=http://127.0.0.1:4300, OPENBOT_SUPERVISOR_TOKEN=smoke-supervisor,
 * OPENBOT_COMPUTER_TOKEN=smoke-computer, OPENBOT_COMPUTER_EGRESS=all), plus this script's object
 * storage: S3_ENDPOINT=http://127.0.0.1:4130 and S3_ENABLE_PATH_STYLE=1. Install the document
 * libraries first: `cd apps/computer/office && bun install`. Python 3 must be on the PATH.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import pg from 'pg';

import { SmokeClient, waitFor } from './client';
import {
  startFakeContentSafety,
  startFakeExpoPush,
  startFakeModel,
  startFakeS3,
  startFakeSupervisor,
} from './fake-services';
import { computerIdForUser, startLocalComputer } from './local-computer';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const DATABASE_URL = process.env.SMOKE_DATABASE_URL ?? process.env.DATABASE_URL;
const SUPERVISOR_TOKEN = process.env.SMOKE_SUPERVISOR_TOKEN ?? 'smoke-supervisor';
const COMPUTER_SECRET = process.env.SMOKE_COMPUTER_TOKEN ?? 'smoke-computer';
const COMPUTER_PORT = Number(process.env.SMOKE_COMPUTER_PORT ?? 4100);
const S3_PORT = Number(process.env.SMOKE_S3_PORT ?? 4130);
const MAINLAND = process.env.APP_REGION === 'cn';
const OFFICE_MODULES = path.resolve('apps/computer/office/node_modules');

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
  file?: { id: string; name: string; size?: number; url: string };
  id: string;
  kind: string;
  status?: string;
  text?: string;
}

interface ChatHistory {
  lines: ChatLine[];
  run: 'idle' | 'running' | 'waiting';
}

/** What a downloaded Office file holds, read with the Python the server's check uses. */
const zipEntries = async (bytes: Buffer) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'biber-download-'));
  try {
    const file = path.join(dir, 'download');
    await writeFile(file, bytes);
    const listed = execFileSync(
      'python3',
      [
        '-c',
        'import json,sys,zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))',
        file,
      ],
      { encoding: 'utf8' },
    );
    return JSON.parse(listed) as string[];
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
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
  const s3 = await startFakeS3(S3_PORT);
  const supervisor = await startFakeSupervisor(Number(process.env.SMOKE_SUPERVISOR_PORT ?? 4300), {
    computerUrl: `http://127.0.0.1:${COMPUTER_PORT}`,
    token: SUPERVISOR_TOKEN,
  });
  let computer: Awaited<ReturnType<typeof startLocalComputer>> | undefined;
  const client = new SmokeClient(BASE_URL);
  const stamp = Date.now();

  const history = (topicId: string) =>
    client.query<ChatHistory>('mobile', 'chat.history', { topicId });

  /** Tool calls approved on the phone, as `identifier/apiName`. */
  const approved: string[] = [];

  /**
   * Waits until the chat is idle and has a reply matching `reply`. Running code on the cloud
   * computer asks the user first, so it approves those calls from the phone's list as they come,
   * the delivery check's included (that run is not the chat's and its calls go to the list).
   */
  const replied = (topicId: string, reply: RegExp) =>
    waitFor(
      `a reply matching ${reply}`,
      async () => {
        const pending = await client.query<
          { apiName: string; id: string; identifier: string; topicId: string | null }[]
        >('mobile', 'approval.listPending', {});
        for (const call of pending.filter((item) => item.topicId === topicId)) {
          await client.mutation('mobile', 'approval.respond', {
            decision: 'approved',
            toolMessageId: call.id,
          });
          approved.push(`${call.identifier}/${call.apiName}`);
        }
        const chat = await history(topicId);
        const found = chat.lines.find(
          (line) => line.kind === 'assistant' && reply.test(line.text ?? ''),
        );
        return chat.run === 'idle' && found ? chat : undefined;
      },
      180_000,
    ).catch(async (error) => {
      const { lines } = await history(topicId);
      const said = lines.map(
        (line) => `${line.kind}: ${(line.text ?? line.status ?? '').slice(0, 200)}`,
      );
      const last = model.requests.findLast((request) => request.path.endsWith('/chat/completions'));
      const results = (last?.messages ?? [])
        .filter((message) => message.role === 'tool')
        .map((message) => JSON.stringify(message.content).slice(0, 300));
      throw new Error(
        `${error}\nthe chat:\n${said.join('\n')}\ntool results:\n${results.join('\n')}`,
      );
    });

  try {
    const email = `documents-${stamp}@biber.test`;
    await client.signUp(email, 'Smoke-pass-12345', 'Documents');
    const { rows } = await db.query('select id from users where email = $1', [email]);
    const userId: string = rows[0].id;
    computer = await startLocalComputer({
      computerId: computerIdForUser(userId),
      env: { NODE_PATH: OFFICE_MODULES },
      port: COMPUTER_PORT,
      secret: COMPUTER_SECRET,
    });

    const agentId = await step(
      'the phone adds the document maker, with the cloud sandbox',
      async () => {
        const { agentId } = await client.mutation<{ agentId: string }>('mobile', 'experts.add', {
          id: 'documents',
          locale: MAINLAND ? 'zh-CN' : 'en-US',
        });
        // Experts run on the user's default model, which has no key locally: use the fake model
        await db.query(`update agents set provider = $1, model = $2 where id = $3`, [
          process.env.SMOKE_MODEL_PROVIDER ?? 'openai',
          process.env.SMOKE_MODEL ?? 'gpt-4o-mini',
          agentId,
        ]);
        const { rows: agent } = await db.query('select plugins from agents where id = $1', [
          agentId,
        ]);
        if (!agent[0]?.plugins?.includes('lobe-cloud-sandbox'))
          throw new Error(JSON.stringify(agent));
        return agentId;
      },
    );

    const topicId = await step(
      'it makes a three-slide deck, hands it over, and the file opens with three slides',
      async () => {
        const { topicId } = await client.mutation<{ topicId: string }>('mobile', 'chat.send', {
          agentId,
          text: '做一份三页的 PPT 介绍 Biber',
        });
        const chat = await replied(topicId, /已交付 deck\.pptx/);
        if (!approved.includes('lobe-cloud-sandbox/executeCode')) {
          throw new Error(`the code ran without the user's approval: ${approved.join(', ')}`);
        }
        const card = chat.lines.find((line) => line.file?.name === 'deck.pptx');
        if (!card?.file) throw new Error(`no file card: ${JSON.stringify(chat.lines)}`);

        const download = await fetch(card.file.url);
        if (!download.ok) throw new Error(`download: HTTP ${download.status}`);
        const entries = await zipEntries(Buffer.from(await download.arrayBuffer()));
        const slides = entries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
        if (!entries.includes('ppt/presentation.xml') || slides.length !== 3) {
          throw new Error(`not a three-slide deck: ${entries.join(', ')}`);
        }
        const { rows: files } = await db.query('select user_id, name from files where id = $1', [
          card.file.id,
        ]);
        if (files[0]?.user_id !== userId || files[0].name !== 'deck.pptx') {
          throw new Error(JSON.stringify(files));
        }
        return topicId;
      },
    );

    await step('an empty file is refused before upload, and it is told why', async () => {
      const before = s3.objects.size;
      await client.mutation('mobile', 'chat.send', { text: '导出一个空文件', topicId });
      await replied(topicId, /The export was refused: the file is empty\./);
      if (s3.objects.size !== before) throw new Error('the empty file was uploaded');
      if ([...s3.objects.keys()].some((key) => key.endsWith('empty.pptx'))) {
        throw new Error('empty.pptx is in storage');
      }
    });

    await step(
      'a reply naming a file never made gets one delivery check, which hands it over',
      async () => {
        await client.mutation('mobile', 'chat.send', { text: '只说报告做好了', topicId });
        const chat = await replied(topicId, /补上了：已交付 report\.xlsx/);
        const checks = chat.lines.filter(
          (line) => line.kind === 'user' && (line.text ?? '').startsWith('（交付核对）'),
        );
        if (checks.length !== 1 || !checks[0].text?.includes('report.xlsx')) {
          throw new Error(`delivery checks: ${JSON.stringify(checks)}`);
        }
        const card = chat.lines.find((line) => line.file?.name === 'report.xlsx');
        if (!card?.file) throw new Error('no file card for report.xlsx');
        const download = await fetch(card.file.url);
        const entries = await zipEntries(Buffer.from(await download.arrayBuffer()));
        if (!entries.includes('xl/workbook.xml')) throw new Error(entries.join(', '));

        // The follow-up's own reply is not checked again
        await new Promise((done) => setTimeout(done, 5000));
        const later = await history(topicId);
        const again = later.lines.filter(
          (line) => line.kind === 'user' && (line.text ?? '').startsWith('（交付核对）'),
        );
        if (again.length !== 1) throw new Error('a second delivery check was sent');
      },
    );

    await step('another account cannot read the chat', async () => {
      const stranger = new SmokeClient(BASE_URL);
      await stranger.signUp(`documents-other-${stamp}@biber.test`, 'Smoke-pass-12345', 'Other');
      const read = await stranger
        .query('mobile', 'chat.history', { topicId })
        .then(() => 'read')
        .catch((error: Error) => error.message);
      if (read === 'read') throw new Error('a stranger read the chat');
    });
  } finally {
    await computer?.stop();
    model.close();
    push.close();
    contentSafety.close();
    s3.close();
    supervisor.close();
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
