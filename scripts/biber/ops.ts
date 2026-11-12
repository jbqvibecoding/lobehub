/**
 * Biber operations, run with a deployment's environment loaded:
 *
 *   bunx tsx scripts/biber/ops.ts bot set <platform> [--application-id ID] [--settings JSON]
 *                                      [--disabled] < credentials.json
 *   bunx tsx scripts/biber/ops.ts bot list
 *   bunx tsx scripts/biber/ops.ts doctor
 *
 * `bot set` stores a shared bot's credentials encrypted with KEY_VAULTS_SECRET, then reads them
 * back the way the server does, so a row the server cannot use is reported at once. Credentials
 * are read from stdin (a JSON object) to keep them out of the shell history; which fields each
 * platform needs is in docs/biber/operations.md.
 *
 * `doctor` checks this deployment against its region, reaches the database and Redis, and makes
 * one call to each configured outside service that changes nothing there, to prove its keys.
 */
import { PLAN_CATALOG } from '@lobechat/billing';
import { regionDeploymentProblems, resolveAppRegion } from '@lobechat/region';
import { sql } from 'drizzle-orm';

import {
  getLarkFamilyConfig,
  getMessengerTelegramConfig,
  getMessengerWechatConfig,
  invalidateMessengerConfigCache,
  isMessengerPlatformEnabled,
  MESSENGER_PLATFORMS,
  type MessengerPlatform,
} from '@/config/messenger';
import { SystemBotProviderModel } from '@/database/models/systemBotProvider';
import { serverDB } from '@/database/server';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { isAppleConfigured } from '@/server/services/billing/apple';
import {
  getAlipay,
  getWechatPay,
  isAlipayConfigured,
  isWechatPayConfigured,
} from '@/server/services/billing/mainland';
import { getStripe, isStripeConfigured } from '@/server/services/billing/stripe';
import { createWechatMpApi } from '@/server/services/messenger/platforms/wechat/api';
import { vendorPushSenders } from '@/server/services/push/vendors';
import { isPhoneSignInEnabled } from '@/server/services/sms';

type Check = { detail: string; name: string; status: 'fail' | 'ok' | 'off' };

const flag = (args: string[], name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const readStdin = async () => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
};

const isPlatform = (value: string | undefined): value is MessengerPlatform =>
  !!value && (MESSENGER_PLATFORMS as readonly string[]).includes(value);

const botSet = async (args: string[]) => {
  const platform = args[0];
  if (!isPlatform(platform)) {
    throw new Error(`bot set <platform>: one of ${MESSENGER_PLATFORMS.join(', ')}`);
  }
  const input = await readStdin();
  if (!input) throw new Error('Pipe the credentials in as a JSON object on stdin');
  const credentials = JSON.parse(input) as Record<string, unknown>;
  const settings = flag(args, 'settings');

  await SystemBotProviderModel.upsertByPlatform(
    serverDB,
    {
      applicationId: flag(args, 'application-id'),
      credentials,
      enabled: !args.includes('--disabled'),
      platform,
      settings: settings ? JSON.parse(settings) : undefined,
    },
    await KeyVaultsGateKeeper.initWithEnvKey(),
  );

  invalidateMessengerConfigCache(platform);
  const usable = await isMessengerPlatformEnabled(platform);
  console.log(
    usable
      ? `${platform}: saved, and the server can use it`
      : `${platform}: saved, but the server cannot use it yet (disabled, or a required field is missing)`,
  );
  if (!usable) process.exitCode = 1;
};

const botList = async () => {
  const rows = await SystemBotProviderModel.listAll(
    serverDB,
    await KeyVaultsGateKeeper.initWithEnvKey(),
  );
  if (rows.length === 0) console.log('No shared bots are configured.');
  for (const row of rows) {
    const fields = Object.keys(row.credentials ?? {})
      .sort()
      .join(', ');
    console.log(
      `${row.platform.padEnd(9)} ${row.enabled ? 'on ' : 'off'} app=${row.applicationId ?? '-'} credentials: ${fields || '(none)'}`,
    );
  }
};

/** Runs one check, turning a thrown error into a failed line. */
const probe = async (name: string, run: () => Promise<string | undefined>): Promise<Check> => {
  try {
    const detail = await run();
    return detail === undefined
      ? { detail: 'not configured', name, status: 'off' }
      : { detail, name, status: 'ok' };
  } catch (error) {
    return { detail: error instanceof Error ? error.message : String(error), name, status: 'fail' };
  }
};

const doctor = async () => {
  const region = resolveAppRegion(process.env.APP_REGION);
  const checks: Check[] = [];

  const problems = regionDeploymentProblems(process.env);
  checks.push(
    problems.length === 0
      ? { detail: `APP_REGION=${region}`, name: 'region', status: 'ok' }
      : { detail: problems.join(' | '), name: 'region', status: 'fail' },
  );

  checks.push(
    await probe('database', async () => {
      const result = await serverDB.execute(
        sql`select count(*)::int as applied from drizzle.__drizzle_migrations`,
      );
      return `${(result.rows[0] as { applied: number }).applied} migrations applied`;
    }),
    await probe('redis', async () => {
      const redis = getAgentRuntimeRedisClient();
      if (!redis) throw new Error('REDIS_URL is not set; link tokens and token caches need it');
      return `answers ${await redis.ping()}`;
    }),
  );

  // Shared bots: the row decodes, and where a call changes nothing, the keys work
  checks.push(
    await probe('bot: telegram', async () => {
      const config = await getMessengerTelegramConfig();
      if (!config) return undefined;
      const response = await fetch(`https://api.telegram.org/bot${config.botToken}/getMe`);
      const data = (await response.json()) as { ok: boolean; result?: { username: string } };
      if (!data.ok) throw new Error('Telegram refused the bot token');
      return `@${data.result?.username}`;
    }),
    await probe('bot: wechat', async () => {
      const config = await getMessengerWechatConfig();
      if (!config) return undefined;
      await createWechatMpApi(config).checkAccess();
      return `${config.appId}, ${config.encodingAESKey ? 'encrypted' : 'PLAIN (set an EncodingAESKey)'}`;
    }),
  );
  for (const platform of ['lark', 'feishu', 'imessage', 'slack', 'discord'] as const) {
    checks.push(
      await probe(`bot: ${platform}`, async () => {
        const usable =
          platform === 'lark' || platform === 'feishu'
            ? !!(await getLarkFamilyConfig(platform))
            : await isMessengerPlatformEnabled(platform);
        return usable ? 'configured (no harmless call to check its keys)' : undefined;
      }),
    );
  }

  // Payments: a lookup that finds nothing still proves the keys and the signatures
  checks.push(
    await probe('pay: stripe', async () => {
      if (!isStripeConfigured()) return undefined;
      const lookupKeys = Object.values(PLAN_CATALOG).flatMap((plan) =>
        plan.stripeLookupKeys ? Object.values(plan.stripeLookupKeys) : [],
      );
      const { data } = await getStripe().prices.list({
        active: true,
        limit: lookupKeys.length,
        lookup_keys: lookupKeys,
      });
      const found = new Set(data.map((price) => price.lookup_key));
      const missing = lookupKeys.filter((key) => !found.has(key));
      if (missing.length > 0) throw new Error(`no active price for ${missing.join(', ')}`);
      return `${data.length} prices`;
    }),
    await probe('pay: wechat pay', async () => {
      if (!isWechatPayConfigured()) return undefined;
      try {
        await getWechatPay().queryOrder('biber-doctor-probe');
      } catch (error) {
        // An order that does not exist is the expected answer: WeChat Pay accepted our signature
        if ((error as { status?: number }).status === 404) return 'keys accepted';
        throw error;
      }
      return 'keys accepted';
    }),
    await probe('pay: alipay', async () => {
      if (!isAlipayConfigured()) return undefined;
      await getAlipay().queryTrade('biber-doctor-probe');
      return 'keys accepted, responses verified';
    }),
    await probe('pay: app store', async () =>
      isAppleConfigured() ? 'root certificates loaded' : undefined,
    ),
  );

  checks.push(
    await probe('sign-in: phone', async () =>
      isPhoneSignInEnabled() ? 'configured (not sending a test text)' : undefined,
    ),
    await probe('push: phone makers', async () => {
      const makers = Object.keys(vendorPushSenders());
      return makers.length > 0 ? makers.join(', ') : undefined;
    }),
  );

  for (const check of checks) {
    const mark = check.status === 'ok' ? '✓' : check.status === 'off' ? '·' : '✗';
    console.log(`${mark} ${check.name.padEnd(20)} ${check.detail}`);
  }
  if (checks.some((check) => check.status === 'fail')) process.exitCode = 1;
};

const main = async () => {
  const [command, sub, ...rest] = process.argv.slice(2);
  if (command === 'bot' && sub === 'set') return botSet(rest);
  if (command === 'bot' && sub === 'list') return botList();
  if (command === 'doctor') return doctor();
  console.log('Usage: ops.ts bot set <platform> | bot list | doctor (see the comment at the top)');
  process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 100));
