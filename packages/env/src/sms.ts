import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Text messages for phone-number sign-in (mainland edition), sent with Alibaba Cloud SMS.
 * Phone sign-in is off while these are unset.
 */
export const getSmsConfig = () => {
  return createEnv({
    runtimeEnv: {
      ALIYUN_SMS_ACCESS_KEY_ID: process.env.ALIYUN_SMS_ACCESS_KEY_ID,
      ALIYUN_SMS_ACCESS_KEY_SECRET: process.env.ALIYUN_SMS_ACCESS_KEY_SECRET,
      ALIYUN_SMS_SIGN_NAME: process.env.ALIYUN_SMS_SIGN_NAME,
      ALIYUN_SMS_TEMPLATE_CODE: process.env.ALIYUN_SMS_TEMPLATE_CODE,
    },
    server: {
      /** A RAM user's AccessKey limited to SMS sending (`dysms:SendSms`) */
      ALIYUN_SMS_ACCESS_KEY_ID: z.string().optional(),
      ALIYUN_SMS_ACCESS_KEY_SECRET: z.string().optional(),
      /** The approved signature shown at the start of each message, e.g. `Biber` */
      ALIYUN_SMS_SIGN_NAME: z.string().optional(),
      /** The approved verification-code template; it takes the code as `${code}` */
      ALIYUN_SMS_TEMPLATE_CODE: z.string().optional(),
    },
  });
};

export const smsEnv = getSmsConfig();
