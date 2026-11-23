/**
 * The model endpoint for Claude Code runs in the cloud sandbox, in Anthropic's format.
 *
 * The sandbox holds no model key. Claude Code is pointed at `<APP_URL>/api/coding/anthropic` and
 * authenticates with the run token it was started with; each call here is:
 * - accepted only while that run is going;
 * - refused once the user's monthly credits are used up, and charged its actual cost after;
 * - on the mainland, refused when the user's latest words are flagged (tool results are not
 *   checked, as in every other model call);
 * - sent to the configured provider with the platform's key, as the configured model, whatever
 *   model Claude Code asked for.
 */
import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';
import type { LobeChatDatabase } from '@lobechat/database';
import {
  buildAnthropicInitialUsage,
  computeChatCost,
  getModelPricing,
} from '@lobechat/model-runtime';
import { isMainlandRegion } from '@lobechat/region';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';

import { agentOperations } from '@/database/schemas';
import { codingEnv } from '@/envs/coding';
import { llmEnv } from '@/envs/llm';
import { regionEnv } from '@/envs/region';
import { assertOIDCUserActive } from '@/libs/oidc-provider/access-control';
import { validateOIDCJWT } from '@/libs/oidc-provider/jwt';
import { BillingService } from '@/server/services/billing';
import { assertUserInputAllowed, refusalMessageOf } from '@/server/services/contentSafety';

const log = debug('lobe-server:coding-gateway');

/** An error answered in Anthropic's error format, so Claude Code shows it and does not retry. */
export class CodingGatewayError extends Error {
  constructor(
    readonly status: number,
    readonly type:
      'api_error' | 'authentication_error' | 'invalid_request_error' | 'permission_error',
    message: string,
  ) {
    super(message);
  }

  toResponse() {
    return Response.json(
      { error: { message: this.message, type: this.type }, type: 'error' },
      { status: this.status },
    );
  }
}

export interface CodingRun {
  operationId: string;
  topicId: string;
  userId: string;
}

/** The provider coding calls go to; see `CODING_*` in `@/envs/coding`. */
export const codingUpstream = () => {
  const provider =
    codingEnv.CODING_MODEL_PROVIDER ??
    (isMainlandRegion(regionEnv.APP_REGION) ? 'deepseek' : 'anthropic');

  if (provider === 'deepseek') {
    return {
      apiKey: llmEnv.DEEPSEEK_API_KEY,
      baseURL: codingEnv.CODING_BASE_URL ?? 'https://api.deepseek.com/anthropic',
      model: codingEnv.CODING_MODEL ?? 'deepseek-v4-pro',
      provider,
    };
  }
  return {
    apiKey: llmEnv.ANTHROPIC_API_KEY,
    baseURL:
      codingEnv.CODING_BASE_URL ?? process.env.ANTHROPIC_PROXY_URL ?? 'https://api.anthropic.com',
    model: codingEnv.CODING_MODEL ?? 'claude-sonnet-5',
    provider,
  };
};

const mainland = () => isMainlandRegion(regionEnv.APP_REGION);

/** The run a token is for, while it is going; anything else is refused. */
export const authenticateRun = async (
  db: LobeChatDatabase,
  token: string | undefined,
): Promise<CodingRun> => {
  const refuse = (why: string) => new CodingGatewayError(401, 'authentication_error', why);
  if (!token) throw refuse('A run token is required');

  let claims: Awaited<ReturnType<typeof validateOIDCJWT>>;
  try {
    claims = await validateOIDCJWT(token, { allowRunTokens: true });
  } catch {
    throw refuse('The run token is not valid');
  }
  const { op, purpose, topic } = claims.tokenData;
  if (purpose !== 'hetero-run' || !op || !topic) throw refuse('Only a run token works here');

  const [operation] = await db
    .select({ status: agentOperations.status })
    .from(agentOperations)
    .where(and(eq(agentOperations.id, op), eq(agentOperations.userId, claims.userId)))
    .limit(1);
  if (operation?.status !== 'running') throw refuse('This run has ended');

  await assertOIDCUserActive(db, claims.userId).catch(() => {
    throw refuse('The account is not active');
  });
  return { operationId: op, topicId: topic, userId: claims.userId };
};

/** The words the user wrote, by message: text blocks only, not tool results. */
const userTexts = (messages: unknown) =>
  (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === 'user')
    .map((message) => {
      const content = message.content;
      if (typeof content === 'string') return content;
      return (Array.isArray(content) ? content : [])
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('\n');
    })
    .filter((text) => text.trim())
    .map((content) => ({ content, role: 'user' }));

interface AnthropicUsage {
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
}

/** What a call cost in credits, at the configured model's price; undefined without a price. */
export const creditsFor = async (
  usage: AnthropicUsage,
  upstream: { model: string; provider: string },
) => {
  const tokens = buildAnthropicInitialUsage({
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
  } as Parameters<typeof buildAnthropicInitialUsage>[0]);
  if (!tokens) return;

  const pricing = await getModelPricing(upstream.model, upstream.provider);
  const cost = computeChatCost(pricing, tokens)?.totalCost;
  return cost === undefined ? undefined : Math.ceil(cost * CREDITS_PER_DOLLAR);
};

/**
 * Follows an Anthropic event stream as it passes through: `message_start` carries the input
 * tokens, each `message_delta` the output tokens so far (and, from some providers, the input).
 */
export const createUsageMeter = () => {
  const usage: AnthropicUsage = {};
  const decoder = new TextDecoder();
  let pending = '';

  const read = (line: string) => {
    if (!line.startsWith('data:')) return;
    let event: any;
    try {
      event = JSON.parse(line.slice(5).trim());
    } catch {
      return;
    }
    if (event?.type !== 'message_start' && event?.type !== 'message_delta') return;
    const found = event.type === 'message_start' ? event.message?.usage : event.usage;
    // Counts in a delta are running totals; a provider that sends 0 for a count it does not
    // repeat must not wipe the one from `message_start`
    for (const key of [
      'cache_creation_input_tokens',
      'cache_read_input_tokens',
      'input_tokens',
      'output_tokens',
    ] as const) {
      if (typeof found?.[key] === 'number') usage[key] = Math.max(usage[key] ?? 0, found[key]);
    }
  };

  return {
    push(chunk: Uint8Array) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      lines.forEach((line) => read(line.trim()));
    },
    usage() {
      if (pending) read(pending.trim());
      pending = '';
      return usage;
    },
  };
};

/**
 * Handles one `POST /v1/messages` from a run: checks, forwards, and charges. Errors come back as
 * Anthropic error responses.
 */
export const forwardMessages = async (
  db: LobeChatDatabase,
  request: Request,
): Promise<Response> => {
  try {
    const token =
      request.headers.get('x-api-key') ??
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
      undefined;
    const run = await authenticateRun(db, token);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw new CodingGatewayError(400, 'invalid_request_error', 'The body is not JSON');
    }
    if (!Array.isArray(body.messages)) {
      throw new CodingGatewayError(400, 'invalid_request_error', 'messages is required');
    }

    const billing = new BillingService(db, run.userId);
    const allowance = await billing.getAllowance();
    if (allowance.remainingCredits <= 0) {
      throw new CodingGatewayError(
        400,
        'invalid_request_error',
        mainland()
          ? `本月的额度已用完，${allowance.period.end.toISOString().slice(0, 10)} 恢复。`
          : `This month's credits are used up; they renew on ${allowance.period.end.toISOString().slice(0, 10)}.`,
      );
    }

    try {
      await assertUserInputAllowed(userTexts(body.messages));
    } catch (error) {
      const refusal = refusalMessageOf(error);
      if (!refusal) throw error;
      throw new CodingGatewayError(400, 'invalid_request_error', refusal);
    }

    const upstream = codingUpstream();
    if (!upstream.apiKey) {
      throw new CodingGatewayError(500, 'api_error', 'The coding model is not configured');
    }

    const charge = async (usage: AnthropicUsage) => {
      const credits = await creditsFor(usage, upstream);
      if (credits === undefined) {
        // console (not debug): a platform-paid call went uncharged because its model has no price
        console.warn(`[billing] no cost for ${upstream.provider}/${upstream.model}; not charged`);
        return;
      }
      log('run %s: charging %d credits', run.operationId, credits);
      await billing
        .chargeCredits(credits)
        .catch((error) => console.error('[billing] charging a coding call failed:', error));
    };

    const headers: Record<string, string> = {
      'anthropic-version': request.headers.get('anthropic-version') ?? '2023-06-01',
      'content-type': 'application/json',
      'x-api-key': upstream.apiKey,
    };
    // Beta features are Anthropic's own; another provider may refuse a header it does not know
    const beta = request.headers.get('anthropic-beta');
    if (beta && upstream.provider === 'anthropic') headers['anthropic-beta'] = beta;

    log(
      'run %s: %s/%s, stream=%s',
      run.operationId,
      upstream.provider,
      upstream.model,
      !!body.stream,
    );
    const response = await fetch(`${upstream.baseURL.replace(/\/+$/, '')}/v1/messages`, {
      body: JSON.stringify({ ...body, model: upstream.model }),
      headers,
      method: 'POST',
      signal: request.signal,
    });

    if (!response.ok || !response.body) {
      log('run %s: upstream answered %d', run.operationId, response.status);
      return new Response(response.body, {
        headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
        status: response.status,
      });
    }

    if (!body.stream) {
      const result = await response.json();
      await charge(result?.usage ?? {});
      return Response.json(result, { status: response.status });
    }

    // Charged once, when the stream ends or the caller goes away mid-way
    const meter = createUsageMeter();
    let charged = false;
    const chargeOnce = () => {
      if (charged) return;
      charged = true;
      return charge(meter.usage());
    };
    request.signal.addEventListener('abort', () => void chargeOnce());

    const metered = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        flush: async () => {
          await chargeOnce();
        },
        transform(chunk, controller) {
          meter.push(chunk);
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(metered, {
      headers: {
        'cache-control': 'no-cache',
        'content-type': response.headers.get('content-type') ?? 'text/event-stream',
      },
      status: response.status,
    });
  } catch (error) {
    if (error instanceof CodingGatewayError) return error.toResponse();
    console.error('[coding-gateway] a call failed:', error);
    return new CodingGatewayError(500, 'api_error', 'The coding model call failed').toResponse();
  }
};
