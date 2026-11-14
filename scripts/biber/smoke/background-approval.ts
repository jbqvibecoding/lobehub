/**
 * Runs nobody is watching ask the phone, against a running server.
 *
 * 1. A task run pauses when the agent wants to run code, and the phone is told.
 * 2. The task stays running while it waits; the phone approves, the run resumes and the task
 *    settles.
 * 3. An API call that does not say how to approve pauses the same way.
 * 4. The expiry endpoint refuses a request that waited longer than a day, and the run carries on.
 *
 *   bunx tsx scripts/biber/smoke/background-approval.ts
 *
 * The server must use the fake model and push service this script starts (see golden-path.ts),
 * and have CRON_SECRET set to SMOKE_CRON_SECRET. The expiry step ages the request in the database,
 * so SMOKE_DATABASE_URL (or DATABASE_URL) must reach the server's database.
 */
import pg from 'pg';

import { SmokeClient, waitFor } from './client';
import { startFakeExpoPush, startFakeModel } from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const CRON_SECRET = process.env.SMOKE_CRON_SECRET!;
const DATABASE_URL = process.env.SMOKE_DATABASE_URL ?? process.env.DATABASE_URL!;

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

const main = async () => {
  if (!CRON_SECRET) throw new Error('Set SMOKE_CRON_SECRET to the server’s CRON_SECRET');
  if (!DATABASE_URL) throw new Error('Set SMOKE_DATABASE_URL to the server’s database');

  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const push = await startFakeExpoPush(Number(process.env.SMOKE_PUSH_PORT ?? 4020));
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();

  const client = new SmokeClient(BASE_URL);
  const stamp = Date.now();
  const pushToken = `ExponentPushToken[background-${stamp}]`;

  const pendingIn = (topicId: string) =>
    waitFor('a pending approval', async () => {
      const items = await client.query<any[]>('mobile', 'approval.listPending', {});
      return items.find((item) => item.topicId === topicId);
    });
  const replyAfterTool = (agentId: string, topicId: string) =>
    waitFor(
      'a reply after the tool',
      async () => {
        const messages = await client.query<any[]>('lambda', 'message.getMessages', {
          agentId,
          topicId,
        });
        const toolAt = messages.findIndex((m) => m.role === 'tool');
        if (toolAt < 0) return undefined;
        return messages
          .slice(toolAt + 1)
          .find((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content);
      },
      120_000,
    );
  const taskTopic = async (taskId: string, topicId: string) => {
    const { data } = await client.query<any>('lambda', 'task.detail', { id: taskId });
    return (data.topics ?? data.activities ?? []).find((topic: any) => topic.id === topicId);
  };

  try {
    await client.signUp(`background-${stamp}@biber.test`, 'Smoke-pass-12345', 'Background');
    await client.mutation('mobile', 'pushToken.register', {
      deviceId: `background-device-${stamp}`,
      expoToken: pushToken,
      locale: 'en-US',
      platform: 'ios',
    });
    const { agentId } = await client.mutation<{ agentId: string }>('lambda', 'agent.createAgent', {
      config: {
        agencyConfig: { executionTarget: 'sandbox' },
        model: 'gpt-4o-mini',
        plugins: ['lobe-cloud-sandbox'],
        provider: 'openai',
        systemRole: '',
        title: 'Background agent',
      },
    });
    const { data: task } = await client.mutation<{ data: { id: string; identifier: string } }>(
      'lambda',
      'task.create',
      {
        assigneeAgentId: agentId,
        instruction: 'Please run code that adds one and one.',
        name: 'Add numbers',
      },
    );

    const run = await step(
      'a task run that wants to run code pauses and asks the phone',
      async () => {
        const started = await client.mutation<{ topicId: string }>('lambda', 'task.run', {
          id: task.id,
        });
        const pending = await pendingIn(started.topicId);
        await waitFor('a push to the phone', async () =>
          push.sent.find((message) => message.to === pushToken),
        );
        return { ...started, toolMessageId: pending.id as string };
      },
    );

    await step('the task stays running while it waits', async () => {
      const { data } = await client.query<any>('lambda', 'task.find', { id: task.id });
      if (data.status !== 'running') throw new Error(`task is ${data.status}`);
      const topic = await taskTopic(task.id, run.topicId);
      if (topic && topic.status !== 'running') throw new Error(`topic is ${topic.status}`);
    });

    await step('approving from the phone resumes the run and settles the task', async () => {
      await client.mutation('mobile', 'approval.respond', {
        decision: 'approved',
        toolMessageId: run.toolMessageId,
      });
      await replyAfterTool(agentId, run.topicId);
      await waitFor(
        'the task to settle',
        async () => {
          const { data } = await client.query<any>('lambda', 'task.find', { id: task.id });
          return data.status === 'running' ? undefined : data.status;
        },
        60_000,
      );
    });

    const apiRun = await step(
      'an API call that does not say how to approve asks the phone too',
      async () => {
        const started = await client.mutation<{ topicId: string }>('lambda', 'aiAgent.execAgent', {
          agentId,
          prompt: 'Please run code that adds two and two.',
          trigger: 'api',
        });
        const pending = await pendingIn(started.topicId);
        return { ...started, toolMessageId: pending.id as string };
      },
    );

    await step('the expiry endpoint refuses callers without the cron secret', async () => {
      const response = await fetch(`${BASE_URL}/api/agent/approvals/expire`, {
        headers: { Authorization: 'Bearer not-the-secret' },
      });
      if (response.status !== 401) throw new Error(`HTTP ${response.status}`);
    });

    await step(
      'a request nobody answered for a day is refused and the run carries on',
      async () => {
        await db.query(
          `update messages set created_at = now() - interval '25 hours' where id = $1`,
          [apiRun.toolMessageId],
        );
        const response = await fetch(`${BASE_URL}/api/agent/approvals/expire`, {
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
        });
        const result = (await response.json()) as { expired: number };
        if (!response.ok || result.expired < 1) {
          throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
        }
        const items = await client.query<any[]>('mobile', 'approval.listPending', {});
        if (items.some((item) => item.id === apiRun.toolMessageId)) {
          throw new Error('the request is still pending');
        }
        await replyAfterTool(agentId, apiRun.topicId);
      },
    );
  } finally {
    model.close();
    push.close();
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
