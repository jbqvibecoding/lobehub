import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const getSandboxConfig = () => {
  return createEnv({
    runtimeEnv: {
      ONLYBOXES_BASE_URL: process.env.ONLYBOXES_BASE_URL,
      ONLYBOXES_JIT_ISSUER: process.env.ONLYBOXES_JIT_ISSUER,
      ONLYBOXES_JIT_SIGNING_KEY: process.env.ONLYBOXES_JIT_SIGNING_KEY,
      ONLYBOXES_JIT_TTL_SEC: process.env.ONLYBOXES_JIT_TTL_SEC,
      ONLYBOXES_LEASE_TTL_SEC: process.env.ONLYBOXES_LEASE_TTL_SEC,
      OPENBOT_COMPUTER_SCOPE: process.env.OPENBOT_COMPUTER_SCOPE,
      OPENBOT_COMPUTER_TOKEN: process.env.OPENBOT_COMPUTER_TOKEN,
      OPENBOT_SUPERVISOR_TOKEN: process.env.OPENBOT_SUPERVISOR_TOKEN,
      OPENBOT_SUPERVISOR_URL: process.env.OPENBOT_SUPERVISOR_URL,
      SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER,
    },
    server: {
      ONLYBOXES_BASE_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
      ONLYBOXES_JIT_ISSUER: z.preprocess(emptyStringToUndefined, z.string().optional()),
      ONLYBOXES_JIT_SIGNING_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
      ONLYBOXES_JIT_TTL_SEC: z.preprocess(
        emptyStringToUndefined,
        z.coerce.number().int().positive().optional(),
      ),
      ONLYBOXES_LEASE_TTL_SEC: z.preprocess(emptyStringToUndefined, z.coerce.number().optional()),
      OPENBOT_COMPUTER_SCOPE: z.preprocess(
        emptyStringToUndefined,
        z.enum(['topic', 'user']).optional(),
      ),
      OPENBOT_COMPUTER_TOKEN: z.preprocess(emptyStringToUndefined, z.string().optional()),
      OPENBOT_SUPERVISOR_TOKEN: z.preprocess(emptyStringToUndefined, z.string().optional()),
      OPENBOT_SUPERVISOR_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
      SANDBOX_PROVIDER: z.preprocess(
        emptyStringToUndefined,
        z.enum(['market', 'onlyboxes', 'openbot']).optional(),
      ),
    },
  });
};

export const sandboxEnv = getSandboxConfig();
