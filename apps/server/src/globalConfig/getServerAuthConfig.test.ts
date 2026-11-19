import { describe, expect, it, vi } from 'vitest';

const SMS = {
  ALIYUN_SMS_ACCESS_KEY_ID: 'id',
  ALIYUN_SMS_ACCESS_KEY_SECRET: 'secret',
  ALIYUN_SMS_SIGN_NAME: 'Biber',
  ALIYUN_SMS_TEMPLATE_CODE: 'SMS_1',
};

const loadAuthConfig = async (APP_REGION: string) => {
  vi.resetModules();
  vi.doMock('@/envs/region', () => ({ regionEnv: { APP_REGION } }));
  vi.doMock('@/envs/sms', () => ({ smsEnv: SMS }));

  const { getServerAuthConfig } = await import('./getServerAuthConfig');
  return getServerAuthConfig();
};

describe('getServerAuthConfig', () => {
  it('offers phone sign-in on the sign-in page of the mainland edition', async () => {
    expect((await loadAuthConfig('cn')).enablePhoneSignIn).toBe(true);
  });

  it('does not offer phone sign-in in the Global edition', async () => {
    expect((await loadAuthConfig('global')).enablePhoneSignIn).toBe(false);
  });
});
