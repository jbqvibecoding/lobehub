import { isMainlandRegion } from '@lobechat/region';
import debug from 'debug';

import { regionEnv } from '@/envs/region';
import { smsEnv } from '@/envs/sms';

import { sendAliyunVerificationCode } from './aliyun';

const log = debug('lobe-server:sms');

/** A mainland China mobile number in E.164 form: +86, then 11 digits starting with 13 to 19. */
const MAINLAND_MOBILE = /^\+861[3-9]\d{9}$/;

/**
 * Phone sign-in takes mainland mobile numbers only. Besides matching the edition, this keeps
 * the code sender from being used to send paid messages to premium-rate numbers abroad.
 */
export const isMainlandMobileNumber = (phoneNumber: string) => MAINLAND_MOBILE.test(phoneNumber);

const aliyunConfig = () => {
  const {
    ALIYUN_SMS_ACCESS_KEY_ID: accessKeyId,
    ALIYUN_SMS_ACCESS_KEY_SECRET: accessKeySecret,
    ALIYUN_SMS_ENDPOINT: endpoint,
    ALIYUN_SMS_SIGN_NAME: signName,
    ALIYUN_SMS_TEMPLATE_CODE: templateCode,
  } = smsEnv;
  return accessKeyId && accessKeySecret && signName && templateCode
    ? { accessKeyId, accessKeySecret, endpoint, signName, templateCode }
    : undefined;
};

/** Phone sign-in exists in the mainland edition once text messages can be sent. */
export const isPhoneSignInEnabled = () =>
  isMainlandRegion(regionEnv.APP_REGION) && !!aliyunConfig();

export const sendVerificationCode = async (phoneNumber: string, code: string) => {
  const config = aliyunConfig();
  if (!config) throw new Error('Text messages are not configured');
  if (!isMainlandMobileNumber(phoneNumber)) throw new Error('Not a mainland China mobile number');

  await sendAliyunVerificationCode(config, phoneNumber, code);
  log('sent a sign-in code to %s', `${phoneNumber.slice(0, 6)}*****${phoneNumber.slice(-2)}`);
};
