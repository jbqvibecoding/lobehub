/**
 * Notifications to a mainland iPhone go to Apple directly, against a running `APP_REGION=cn`
 * server: an iPhone registers its APNs device token, an agent run pauses for approval, and the
 * phone gets the notification from APNs with the Approve / Reject buttons, signed with the team's
 * key; a phone Apple no longer knows is forgotten and not sent to again.
 *
 *   SMOKE_APNS_KEY=<the .p8 key the server uses> bunx tsx scripts/biber/smoke/apns.ts
 *
 * The server needs APNS_KEY_ID=SMOKEKEY01, APNS_TEAM_ID=SMOKETEAM1, APNS_PRIVATE_KEY set to that
 * key, and APNS_ENDPOINT=http://127.0.0.1:4110; and the fake model and content-safety stand-in
 * this script starts (see operations.md §9).
 */
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { SmokeClient, waitFor } from './client';
import { startFakeApns, startFakeContentSafety, startFakeModel } from './fake-services';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3011';

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
  const keyFile = process.env.SMOKE_APNS_KEY;
  if (!keyFile) throw new Error('Set SMOKE_APNS_KEY to the .p8 key the server signs with');
  const publicKey = createPublicKey(createPrivateKey(readFileSync(keyFile, 'utf8')))
    .export({ format: 'pem', type: 'spki' })
    .toString();
  const apns = await startFakeApns(Number(process.env.SMOKE_APNS_PORT ?? 4110), publicKey);
  const model = await startFakeModel(Number(process.env.SMOKE_MODEL_PORT ?? 4010));
  // The mainland edition refuses requests it cannot check
  const contentSafety = await startFakeContentSafety(
    Number(process.env.SMOKE_CONTENT_SAFETY_PORT ?? 4090),
  );
  const client = new SmokeClient(BASE_URL);
  const stamp = Date.now();
  const phone = `a1b2c3${stamp}`;
  const oldPhone = `gone${stamp}`;

  const runCode = async () => {
    await client.mutation('lambda', 'aiAgent.execAgent', {
      agentId,
      prompt: 'Please run code that adds one and one.',
      userInterventionConfig: { approvalMode: 'manual' },
    });
    return waitFor(
      'a pending approval',
      async () => {
        const items = await client.query<any[]>('mobile', 'approval.listPending', {});
        return items.find((item) => !seen.has(item.id)) ?? undefined;
      },
      120_000,
    );
  };
  const seen = new Set<string>();
  let agentId = '';

  try {
    await client.signUp(`apns-${stamp}@biber.test`, 'Smoke-pass-12345', 'APNs');
    ({ agentId } = await client.mutation<{ agentId: string }>('lambda', 'agent.createAgent', {
      config: {
        agencyConfig: { executionTarget: 'sandbox' },
        model: process.env.SMOKE_MODEL ?? 'deepseek-v4-flash',
        plugins: ['lobe-cloud-sandbox'],
        provider: process.env.SMOKE_MODEL_PROVIDER ?? 'deepseek',
        systemRole: '',
        title: 'APNs smoke agent',
      },
    }));

    await step('an iPhone registers its APNs device token', async () => {
      for (const [deviceId, token] of [
        [`iphone-${stamp}`, phone],
        [`old-iphone-${stamp}`, oldPhone],
      ]) {
        await client.mutation('mobile', 'pushToken.register', {
          deviceId,
          expoToken: token,
          locale: 'zh-CN',
          platform: 'ios',
          provider: 'apns',
        });
      }
    });

    const pending = await step('a run that needs approval pauses', async () => {
      const item = await runCode();
      seen.add(item.id);
      return item;
    });

    await step('the iPhone gets it from APNs, signed with the team key', async () => {
      const push = await waitFor('a notification through APNs', async () =>
        apns.sent.find((sent) => sent.token === phone),
      );
      const { claims, header, signed } = push.providerToken;
      if (!signed || header?.alg !== 'ES256' || header.kid !== 'SMOKEKEY01') {
        throw new Error(`provider token: ${JSON.stringify(push.providerToken)}`);
      }
      if (claims?.iss !== 'SMOKETEAM1') throw new Error(`issuer ${claims?.iss}`);
      if (push.headers['apns-topic'] !== 'ai.biber.app.cn') {
        throw new Error(`topic ${push.headers['apns-topic']}`);
      }
    });

    await step(
      'with Approve / Reject, the approval it is about and the text in Chinese',
      async () => {
        const push = apns.sent.find((sent) => sent.token === phone)!;
        if (push.payload.aps?.category !== 'approval') {
          throw new Error(JSON.stringify(push.payload));
        }
        if (push.payload.body?.toolMessageId !== pending.id) {
          throw new Error(`about ${push.payload.body?.toolMessageId}, not ${pending.id}`);
        }
        if (!/\p{Script=Han}/u.test(push.payload.aps.alert?.title ?? '')) {
          throw new Error(`title ${push.payload.aps.alert?.title}`);
        }
      },
    );

    await step('a phone Apple no longer knows is forgotten', async () => {
      if (!apns.sent.some((sent) => sent.token === oldPhone)) {
        throw new Error('the old phone was never tried');
      }
      await client.mutation('mobile', 'approval.respond', {
        decision: 'rejected',
        toolMessageId: pending.id,
      });
      const before = apns.sent.length;
      seen.add((await runCode()).id);
      await waitFor('the second notification', async () =>
        apns.sent.slice(before).find((sent) => sent.token === phone),
      );
      if (apns.sent.slice(before).some((sent) => sent.token === oldPhone)) {
        throw new Error('sent to the forgotten phone again');
      }
    });
  } finally {
    apns.close();
    model.close();
    contentSafety.close();
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
