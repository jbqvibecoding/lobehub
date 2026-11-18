/**
 * What Biber remembers, against a running server, through the routes the phone app calls: a
 * memory the agent stores shows on the phone; forgetting it there removes it from what the agent
 * can retrieve; another account cannot forget it; forgetting everything clears the list.
 *
 *   bunx tsx scripts/biber/smoke/memories.ts
 *
 * The server must use the fake model this script starts, which also serves embeddings (see
 * golden-path.ts).
 */
import { SmokeClient } from './client';
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

interface MemoryPage {
  hasMore: boolean;
  items: { id: string; layer: string | null; title: string | null }[];
}

/** A preference as the agent's memory tool stores it. */
const preference = (title: string, directive: string) => ({
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
    scorePriority: 0.5,
    suggestions: [],
    type: 'travel',
  },
});

const main = async () => {
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const client = new SmokeClient(BASE_URL);
  const stranger = new SmokeClient(BASE_URL);
  const stamp = Date.now();

  const list = () => client.query<MemoryPage>('mobile', 'memories.list', { page: 1 });
  const remember = (title: string, directive: string) =>
    client.mutation('lambda', 'userMemories.toolAddPreferenceMemory', preference(title, directive));

  try {
    await client.signUp(`memories-${stamp}@biber.test`, 'Smoke-pass-12345', 'Memories');
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
