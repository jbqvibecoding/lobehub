// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendAliyunVerificationCode } from '../aliyun';

const env = vi.hoisted(() => ({
  region: { APP_REGION: 'cn' },
  sms: {
    ALIYUN_SMS_ACCESS_KEY_ID: 'id',
    ALIYUN_SMS_ACCESS_KEY_SECRET: 'secret',
    ALIYUN_SMS_SIGN_NAME: 'Biber',
    ALIYUN_SMS_TEMPLATE_CODE: 'SMS_1',
  } as Record<string, string | undefined>,
}));

vi.mock('@/envs/region', () => ({ regionEnv: env.region }));
vi.mock('@/envs/sms', () => ({ smsEnv: env.sms }));
vi.mock('../aliyun', () => ({ sendAliyunVerificationCode: vi.fn() }));

const sms = await import('../index');

describe('phone sign-in codes', () => {
  beforeEach(() => {
    env.region.APP_REGION = 'cn';
    env.sms.ALIYUN_SMS_TEMPLATE_CODE = 'SMS_1';
    vi.clearAllMocks();
  });

  it('accepts mainland mobile numbers only', () => {
    expect(sms.isMainlandMobileNumber('+8613800138000')).toBe(true);
    expect(sms.isMainlandMobileNumber('+14155550100')).toBe(false);
    expect(sms.isMainlandMobileNumber('+861080001234')).toBe(false);
  });

  it('is on in the mainland edition once text messages are configured', () => {
    expect(sms.isPhoneSignInEnabled()).toBe(true);

    env.region.APP_REGION = 'global';
    expect(sms.isPhoneSignInEnabled()).toBe(false);

    env.region.APP_REGION = 'cn';
    env.sms.ALIYUN_SMS_TEMPLATE_CODE = undefined;
    expect(sms.isPhoneSignInEnabled()).toBe(false);
  });

  it('never texts a number abroad', async () => {
    await expect(sms.sendVerificationCode('+14155550100', '123456')).rejects.toThrow();
    expect(sendAliyunVerificationCode).not.toHaveBeenCalled();

    await sms.sendVerificationCode('+8613800138000', '123456');
    expect(sendAliyunVerificationCode).toHaveBeenCalledWith(
      expect.objectContaining({ signName: 'Biber' }),
      '+8613800138000',
      '123456',
    );
  });
});
