import { APP_REGIONS, DEFAULT_APP_REGION } from '@lobechat/region';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const normalizeRegion = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  return normalized === '' ? undefined : normalized;
};

/**
 * Which edition this deployment serves. See `@lobechat/region` for what depends on it; production
 * deployments must set it explicitly (checked at server start in `src/instrumentation.ts`).
 */
export const getRegionConfig = () => {
  return createEnv({
    runtimeEnv: {
      APP_REGION: process.env.APP_REGION,
    },
    server: {
      APP_REGION: z.preprocess(normalizeRegion, z.enum(APP_REGIONS).default(DEFAULT_APP_REGION)),
    },
  });
};

export const regionEnv = getRegionConfig();
