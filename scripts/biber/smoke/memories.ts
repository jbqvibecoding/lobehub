/**
 * What Biber remembers, against a running server, through the routes the phone app calls: a
 * memory the agent stores shows on the phone; forgetting it there removes it from what the agent
 * can retrieve; another account cannot forget it; forgetting everything clears the list. The
 * agent cannot save a password as a memory, and the key facts (who the person is, the rules they
 * set) reach every run verbatim. Undoing what a chat taught takes it back and marks the chat so it
 * is not learned from again.
 *
 *   SMOKE_DATABASE_URL=postgres://… bunx tsx scripts/biber/smoke/memories.ts
 *
 * The server must use the fake model this script starts, which also serves embeddings (see
 * golden-path.ts). Memory extraction runs as an Upstash workflow, which this setup does not run,
 * so the undo step writes the record an extraction leaves straight into the server's database.
 */
import pg from 'pg';

import { SmokeClient, waitFor } from './client';
import { startFakeModel } from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const DATABASE_URL = process.env.SMOKE_DATABASE_URL ?? process.env.DATABASE_URL;

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

interface MemoryPage {
  hasMore: boolean;
  items: { id: string; layer: string | null; title: string | null }[];
}

/** A preference as the agent's memory tool stores it. */
const preference = (title: string, directive: string, scorePriority = 0.5) => ({
  details: '',
  memoryCategory: 'travel',
  memoryType: 'preference',
  summary: `${title}: ${directive}`,
  tags: ['travel'],
  title,
  withPreference: {
    appContext: null,
    conclusionDirectives: directive,
    extractedLabels: [],
    extractedScopes: [],
    originContext: null,
    scorePriority,
    suggestions: [],
    type: 'travel',
  },
});

const main = async () => {
  if (!DATABASE_URL) throw new Error('Set SMOKE_DATABASE_URL to the server’s database');
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const client = new SmokeClient(BASE_URL);
  const stranger = new SmokeClient(BASE_URL);
  const stamp = Date.now();

  const list = () => client.query<MemoryPage>('mobile', 'memories.list', { page: 1 });
  const remember = (title: string, directive: string, priority?: number) =>
    client.mutation(
      'lambda',
      'userMemories.toolAddPreferenceMemory',
      preference(title, directive, priority),
    );
  const textOf = (content: unknown) =>
    typeof content === 'string' ? content : JSON.stringify(content ?? '');

  try {
    const email = `memories-${stamp}@biber.test`;
    await client.signUp(email, 'Smoke-pass-12345', 'Memories');
    await stranger.signUp(`memories-other-${stamp}@biber.test`, 'Smoke-pass-12345', 'Other');

    const seat = await step('a memory the agent stores shows on the phone', async () => {
      await remember('Seat on flights', 'Book a window seat');
      const { items } = await list();
      const found = items.find((item) => item.title === 'Seat on flights');
      if (!found || found.layer !== 'preference') throw new Error(JSON.stringify(items));
      return found;
    });

    await step('another account cannot forget it', async () => {
      const result = await stranger.mutation<{ forgotten: boolean }>('mobile', 'memories.forget', {
        id: seat.id,
      });
      if (result.forgotten) throw new Error('forgot someone else’s memory');
      if (!(await list()).items.some((item) => item.id === seat.id)) throw new Error('it is gone');
    });

    await step('forgetting it on the phone removes it from what the agent retrieves', async () => {
      await client.mutation('mobile', 'memories.forget', { id: seat.id });
      if ((await list()).items.length > 0) throw new Error('still listed');
      const left = await client.query<unknown[]>('lambda', 'userMemory.getPreferences');
      if (left.length > 0) throw new Error(`the agent still finds ${JSON.stringify(left)}`);
    });

    await step('forgetting everything clears the list', async () => {
      await remember('Coffee', 'Order oat milk');
      await remember('Meetings', 'No meetings before ten');
      if ((await list()).items.length !== 2) throw new Error('not both stored');
      await client.mutation('mobile', 'memories.forgetAll');
      if ((await list()).items.length > 0) throw new Error('still listed');
    });

    await step('the agent cannot save a password as a memory', async () => {
      const refused = await remember('Wifi', 'The home wifi password is Tr0ub4dor').then(
        () => undefined,
        (error: unknown) => String(error),
      );
      if (!refused?.includes('Not saved'))
        throw new Error(`saved, or failed otherwise: ${refused}`);
      if ((await list()).items.length > 0) throw new Error('something was stored');
    });

    await step('key facts reach every run verbatim', async () => {
      await client.mutation('lambda', 'userMemories.toolAddIdentityMemory', {
        details: null,
        memoryCategory: 'health',
        memoryType: 'fact',
        summary: 'Severely allergic to peanuts',
        tags: ['health'],
        title: 'Peanut allergy',
        withIdentity: {
          description: 'Severely allergic to peanuts',
          episodicDate: null,
          extractedLabels: [],
          relationship: 'self',
          role: 'patient',
          scoreConfidence: 0.9,
          sourceEvidence: null,
          type: 'personal',
        },
      });
      await remember('Mornings', 'Never book anything before 9am', 0.9);
      const { agentId } = await client.mutation<{ agentId: string }>(
        'lambda',
        'agent.createAgent',
        {
          config: {
            model: 'gpt-4o-mini',
            provider: 'openai',
            systemRole: '',
            title: 'Facts agent',
          },
        },
      );
      const before = model.requests.length;
      await client.mutation('lambda', 'aiAgent.execAgent', { agentId, prompt: 'hello there' });
      await waitFor(
        'the model to be given the key facts',
        async () =>
          model.requests
            .slice(before)
            .find((request) =>
              request.messages.some(
                (message) =>
                  textOf(message.content).includes('Severely allergic to peanuts') &&
                  textOf(message.content).includes('Never book anything before 9am'),
              ),
            ),
        60_000,
      );
    });

    await step(
      'undoing what a chat taught takes it back, and the chat is not learned from again',
      async () => {
        await remember('Hotels', 'Book hotels near the station');
        const hotel = (await list()).items.find((item) => item.title === 'Hotels');
        if (!hotel) throw new Error('not stored');
        const {
          rows: [topic],
        } = await db.query(
          `SELECT t.id FROM topics t JOIN users u ON u.id = t.user_id
          WHERE u.email = $1 ORDER BY t.created_at DESC LIMIT 1`,
          [email],
        );
        if (!topic) throw new Error('the run left no conversation');
        // What an extraction from that conversation leaves behind
        await db.query(
          `INSERT INTO user_memory_extractions (id, user_id, topic_id, added_memory_ids)
         SELECT $1, user_id, id, $2::jsonb FROM topics WHERE id = $3`,
          [`smoke-undo-${stamp}`, JSON.stringify([hotel.id]), topic.id],
        );

        const recent = await client.query<{ added: number; id: string }[]>(
          'mobile',
          'memories.recentExtractions',
        );
        if (recent.length !== 1 || recent[0].added !== 1) throw new Error(JSON.stringify(recent));
        const refused = await stranger.mutation<{ undone: boolean }>(
          'mobile',
          'memories.undoExtraction',
          { id: recent[0].id },
        );
        if (refused.undone) throw new Error('another account undid it');

        const undone = await client.mutation<{ forgotten: number; undone: boolean }>(
          'mobile',
          'memories.undoExtraction',
          { id: recent[0].id },
        );
        if (!undone.undone || undone.forgotten !== 1) throw new Error(JSON.stringify(undone));
        if ((await list()).items.some((item) => item.id === hotel.id))
          throw new Error('still listed');
        const left = await client.query<unknown[]>('lambda', 'userMemory.getPreferences');
        if (left.some((row) => JSON.stringify(row).includes('near the station'))) {
          throw new Error('the agent still finds it');
        }
        const {
          rows: [marked],
        } = await db.query(
          `SELECT metadata->>'userMemoryExtractUndone' AS undone FROM topics WHERE id = $1`,
          [topic.id],
        );
        if (marked?.undone !== 'true') throw new Error('the chat is not marked');
        if ((await client.query<unknown[]>('mobile', 'memories.recentExtractions')).length > 0) {
          throw new Error('still offered for undo');
        }
      },
    );
  } finally {
    model.close();
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
