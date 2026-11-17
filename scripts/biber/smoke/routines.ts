/**
 * Starter routines, against a running server, through the routes the phone app calls: a new
 * account sees them all off; turning the morning brief on gives Biber a scheduled task in the
 * phone's time zone, which runs and settles; turning it off stops the schedule and keeps the task.
 *
 *   bunx tsx scripts/biber/smoke/routines.ts
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

interface Routine {
  enabled: boolean;
  id: string;
  name: string;
  taskId?: string;
}

const main = async () => {
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  const client = new SmokeClient(BASE_URL);

  const list = () => client.query<Routine[]>('mobile', 'routines.list', { locale: 'zh-CN' });
  const findTask = async (id: string) =>
    (await client.query<{ data: any }>('lambda', 'task.find', { id })).data;

  try {
    await client.signUp(`routines-${Date.now()}@biber.test`, 'Smoke-pass-12345', 'Routines');

    await step('a new account sees the starter routines, all off', async () => {
      const routines = await list();
      if (routines.length !== 3 || routines.some((routine) => routine.enabled)) {
        throw new Error(JSON.stringify(routines));
      }
      if (routines[0].name !== '晨报') throw new Error(`named ${routines[0].name}`);
    });

    const taskId = await step(
      'turning the morning brief on schedules it for Biber in the phone time zone',
      async () => {
        const { taskId: id } = await client.mutation<{ taskId: string }>(
          'mobile',
          'routines.enable',
          { id: 'morning-brief', locale: 'zh-CN', timeZone: 'Asia/Shanghai' },
        );
        const task = await findTask(id);
        if (
          task.automationMode !== 'schedule' ||
          task.schedulePattern !== '30 7 * * *' ||
          task.scheduleTimezone !== 'Asia/Shanghai' ||
          task.status !== 'scheduled' ||
          !task.assigneeAgentId
        ) {
          throw new Error(JSON.stringify(task));
        }
        if (!(await list())[0].enabled) throw new Error('still shown as off');
        return id;
      },
    );

    await step('the routine runs with Biber and settles', async () => {
      await client.mutation('lambda', 'task.run', { id: taskId });
      await waitFor(
        'the run to settle',
        async () => {
          const task = await findTask(taskId);
          return task.status === 'running' ? undefined : task.status;
        },
        120_000,
      );
    });

    await step('turning it off stops the schedule and keeps the task', async () => {
      await client.mutation('mobile', 'routines.disable', { id: 'morning-brief' });
      const task = await findTask(taskId);
      if (task.automationMode !== null) throw new Error(`still ${task.automationMode}`);
      if ((await list())[0].enabled) throw new Error('still shown as on');
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
