import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) => (value === '' ? undefined : value);

/**
 * The model behind Claude Code runs in the cloud sandbox. The sandbox never holds a model key:
 * Claude Code calls `/api/coding/anthropic/v1/messages` on this server with its run token, and
 * the server forwards the call to this provider with the platform's key.
 */
export const getCodingConfig = () => {
  return createEnv({
    runtimeEnv: {
      CODING_BASE_URL: process.env.CODING_BASE_URL,
      CODING_MODEL: process.env.CODING_MODEL,
      CODING_MODEL_PROVIDER: process.env.CODING_MODEL_PROVIDER,
    },
    server: {
      /**
       * The provider's Anthropic-format endpoint, without `/v1/messages`. Defaults to Anthropic's
       * own API (or `ANTHROPIC_PROXY_URL`) for `anthropic`, and to DeepSeek's Anthropic-compatible
       * endpoint for `deepseek`.
       */
      CODING_BASE_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
      /** The model every call is sent to, whatever Claude Code asks for. */
      CODING_MODEL: z.preprocess(emptyStringToUndefined, z.string().optional()),
      /**
       * Whose key pays and whose prices are charged: `anthropic` (the default in the global
       * edition, `ANTHROPIC_API_KEY`) or `deepseek` (the default in the mainland edition,
       * `DEEPSEEK_API_KEY`).
       */
      CODING_MODEL_PROVIDER: z.preprocess(
        emptyStringToUndefined,
        z.enum(['anthropic', 'deepseek']).optional(),
      ),
    },
  });
};

export const codingEnv = getCodingConfig();
