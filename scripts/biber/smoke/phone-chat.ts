/**
 * Chat on the phone, against a running server, through the routes the phone app calls:
 *
 * 1. A new chat with Biber gets a reply, and shows up in the list of chats.
 * 2. A chat with an agent that wants to run code waits for an answer; approving it right there
 *    resumes the run, and the reply arrives.
 * 3. Nobody else can read the conversation.
 *
 *   bunx tsx scripts/biber/smoke/phone-chat.ts
 *
 * The server must use the fake model this script starts (see golden-path.ts).
 */
import { SmokeClient, waitFor } from './client';
import { startFakeModel } from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';

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
  lines: { id: string; kind: string; status?: string; text?: string }[];
  run: 'idle' | 'running' | 'waiting';
}

const main = async () => {
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const client = new SmokeClient(BASE_URL);
  const stamp = Date.now();

  const history = (topicId: string) =>
    client.query<ChatHistory>('mobile', 'chat.history', { topicId });
  const reply = (topicId: string, text: RegExp) =>
    waitFor(
      `a reply matching ${text}`,
      async () => {
        const { lines, run } = await history(topicId);
        const found = lines.find((line) => line.kind === 'assistant' && text.test(line.text ?? ''));
        return found && run === 'idle' ? found : undefined;
      },
      120_000,
    );

  try {
    await client.signUp(`phone-chat-${stamp}@biber.test`, 'Smoke-pass-12345', 'Phone chat');

    const biberChat = await step('a new chat with Biber gets a reply', async () => {
      const { topicId } = await client.mutation<{ topicId: string }>('mobile', 'chat.send', {
        text: 'hello there',
      });
      await reply(topicId, /\S/);
      return topicId;
    });

    await step('the chat shows up in the list of chats', async () => {
      const recent = await client.query<{ id: string }[]>('mobile', 'topic.recentTopics', {
        limit: 30,
      });
      if (!recent.some((conversation) => conversation.id === biberChat)) {
        throw new Error(`not listed: ${JSON.stringify(recent)}`);
      }
    });

    const { agentId } = await client.mutation<{ agentId: string }>('lambda', 'agent.createAgent', {
      config: {
        agencyConfig: { executionTarget: 'sandbox' },
        model: 'gpt-4o-mini',
        plugins: ['lobe-cloud-sandbox'],
        provider: 'openai',
        systemRole: '',
        title: 'Phone chat agent',
      },
    });

    const waiting = await step(
      'a chat with an agent that runs code waits for an answer',
      async () => {
        const { topicId } = await client.mutation<{ topicId: string }>('mobile', 'chat.send', {
          agentId,
          text: 'Please run code that adds one and one.',
        });
        const call = await waitFor(
          'the call to wait',
          async () => {
            const { lines, run } = await history(topicId);
            const tool = lines.find((line) => line.kind === 'tool' && line.status === 'waiting');
            return tool && run === 'waiting' ? tool : undefined;
          },
          120_000,
        );
        return { toolMessageId: call.id, topicId };
      },
    );

    await step('approving in the chat resumes the run and the reply arrives', async () => {
      await client.mutation('mobile', 'approval.respond', {
        decision: 'approved',
        toolMessageId: waiting.toolMessageId,
      });
      await reply(waiting.topicId, /The code ran/);
    });

    await step('nobody else can read the conversation', async () => {
      const stranger = new SmokeClient(BASE_URL);
      await stranger.signUp(`phone-chat-other-${stamp}@biber.test`, 'Smoke-pass-12345', 'Other');
      const read = await stranger
        .query('mobile', 'chat.history', { topicId: waiting.topicId })
        .then(() => 'read')
        .catch((error: unknown) => String(error));
      if (read === 'read' || !/NOT_FOUND|No such conversation/.test(read)) {
        throw new Error(`expected NOT_FOUND, got ${read}`);
      }
    });
  } finally {
    model.close();
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
