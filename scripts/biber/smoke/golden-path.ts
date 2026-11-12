/**
 * The golden path, against a running server: sign up, register the phone for push, ask an agent
 * to run code on the cloud computer, see the run pause and the phone get "needs you", approve it
 * from the phone API, and find the decision in the activity trail.
 *
 *   bunx tsx scripts/biber/smoke/golden-path.ts
 *
 * The server must use the fake model and push service this script starts:
 *   OPENAI_API_KEY=sk-smoke OPENAI_PROXY_URL=http://127.0.0.1:4010/v1
 *   EXPO_BASE_URL=http://127.0.0.1:4020
 * Set SMOKE_START_FAKES=0 when they already run elsewhere.
 */
import { SmokeClient, waitFor } from './client';
import { CODE_TOOL, startFakeExpoPush, startFakeModel } from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const MODEL_PORT = Number(process.env.SMOKE_MODEL_PORT ?? 4010);
const PUSH_PORT = Number(process.env.SMOKE_PUSH_PORT ?? 4020);

const steps: { detail: string; name: string; ok: boolean }[] = [];
const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
  const started = Date.now();
  try {
    const value = await run();
    steps.push({ detail: `${Date.now() - started} ms`, name, ok: true });
    console.log(`✓ ${name}`);
    return value;
  } catch (error) {
    steps.push({ detail: String(error), name, ok: false });
    console.log(`✗ ${name}: ${error}`);
    throw error;
  }
};

const main = async () => {
  const fakes =
    process.env.SMOKE_START_FAKES === '0'
      ? undefined
      : { model: await startFakeModel(MODEL_PORT), push: await startFakeExpoPush(PUSH_PORT) };

  const client = new SmokeClient(BASE_URL);
  const stamp = Date.now();
  const pushToken = `ExponentPushToken[smoke-${stamp}]`;

  try {
    await step('sign up', () =>
      client.signUp(`smoke-${stamp}@biber.test`, 'Smoke-pass-12345', 'Smoke'),
    );

    await step('register the phone for push', () =>
      client.mutation('mobile', 'pushToken.register', {
        deviceId: `smoke-device-${stamp}`,
        expoToken: pushToken,
        locale: 'en-US',
        platform: 'ios',
      }),
    );

    const { agentId } = await step('create an agent that may use the cloud computer', () =>
      client.mutation<{ agentId: string }>('lambda', 'agent.createAgent', {
        config: {
          // Runs on the cloud computer, which is what offers the code tool
          agencyConfig: { executionTarget: 'sandbox' },
          model: 'gpt-4o-mini',
          plugins: ['lobe-cloud-sandbox'],
          provider: 'openai',
          systemRole: '',
          title: 'Smoke agent',
        },
      }),
    );

    const run = await step('ask the agent to run code', () =>
      client.mutation<{ operationId: string; topicId: string }>('lambda', 'aiAgent.execAgent', {
        agentId,
        prompt: 'Please run code that adds one and one.',
        // As the web client starts a run for someone who approves actions; without it the run is
        // headless and runs tools that ask for approval without asking
        userInterventionConfig: { approvalMode: 'manual' },
      }),
    );

    const pending = await step('the run pauses for approval and the phone sees it', () =>
      waitFor('a pending approval', async () => {
        const items = await client.query<any[]>('mobile', 'approval.listPending', {});
        return items.find((item) => JSON.stringify(item).includes('executeCode')) ?? undefined;
      }),
    );

    if (fakes) {
      await step('the model was offered the code tool', async () => {
        const offered = fakes.model.requests.some((r) => r.tools.includes(CODE_TOOL));
        if (!offered) {
          throw new Error(
            `requests: ${JSON.stringify(fakes.model.requests.map((r) => ({ path: r.path, tools: r.tools.length })))}`,
          );
        }
      });

      await step('the phone is told it is needed', () =>
        waitFor('a push to the phone', async () =>
          fakes.push.sent.find((message) => message.to === pushToken),
        ),
      );
    }

    const toolMessageId = pending.id ?? pending.toolMessageId ?? pending.messageId;
    await step('approve from the phone', () =>
      client.mutation('mobile', 'approval.respond', { decision: 'approved', toolMessageId }),
    );

    await step('the decision is in the activity trail', () =>
      waitFor('an approved event', async () => {
        const page = await client.query<any>('mobile', 'activity.list', {});
        const events: any[] = page.items ?? page.events ?? page;
        return events.find((event) => JSON.stringify(event).includes('approved'));
      }),
    );

    // Approving resumes the run as a new operation, so the conversation is what shows its end
    await step('the run resumes and replies after the tool', () =>
      waitFor(
        'a reply after the tool',
        async () => {
          const messages = await client.query<any[]>('lambda', 'message.getMessages', {
            agentId,
            topicId: run.topicId,
          });
          const toolAt = messages.findIndex((m) => m.role === 'tool');
          if (toolAt < 0) return undefined;
          return messages
            .slice(toolAt + 1)
            .find((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content);
        },
        120_000,
      ),
    );
  } finally {
    fakes?.model.close();
    fakes?.push.close();
    const failed = steps.filter((s) => !s.ok).length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed`);
    if (fakes && process.env.SMOKE_VERBOSE) {
      console.log(
        JSON.stringify(
          fakes.model.requests.map((r) => ({ path: r.path, tools: r.tools })),
          null,
          1,
        ),
      );
    }
  }
};

main().then(
  () => process.exit(0),
  () => process.exit(1),
);
