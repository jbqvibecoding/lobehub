import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Content safety for the mainland edition: what users ask the models is checked with Alibaba
 * Cloud Content Moderation (Text Moderation Plus) before it is sent. Off while these are unset.
 */
export const getContentSafetyConfig = () => {
  return createEnv({
    runtimeEnv: {
      ALIYUN_GREEN_ACCESS_KEY_ID: process.env.ALIYUN_GREEN_ACCESS_KEY_ID,
      ALIYUN_GREEN_ACCESS_KEY_SECRET: process.env.ALIYUN_GREEN_ACCESS_KEY_SECRET,
      ALIYUN_GREEN_ENDPOINT: process.env.ALIYUN_GREEN_ENDPOINT,
      CONTENT_SAFETY_ON_ERROR: process.env.CONTENT_SAFETY_ON_ERROR,
    },
    server: {
      /** A RAM user's AccessKey limited to text moderation (`yundun-greenweb:TextModerationPlus`) */
      ALIYUN_GREEN_ACCESS_KEY_ID: z.string().optional(),
      ALIYUN_GREEN_ACCESS_KEY_SECRET: z.string().optional(),
      /** The moderation endpoint, e.g. `https://green-cip.cn-shanghai.aliyuncs.com` (the default) */
      ALIYUN_GREEN_ENDPOINT: z.string().url().optional(),
      /**
       * What happens to a request when the check itself fails (timeout, outage): `block` refuses
       * it (the default), `allow` lets it through and logs the failure.
       */
      CONTENT_SAFETY_ON_ERROR: z.enum(['allow', 'block']).optional(),
    },
  });
};

export const contentSafetyEnv = getContentSafetyConfig();
