// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendAliyunVerificationCode, signAliyunRequest } from '../aliyun';

const request = (overrides: Partial<Parameters<typeof signAliyunRequest>[0]> = {}) =>
  signAliyunRequest({
    accessKeyId: 'LTAI-test',
    accessKeySecret: 'secret-test',
    action: 'SendSms',
    date: '2026-11-11T08:00:00Z',
    nonce: 'nonce-1',
    query: { PhoneNumbers: '13800138000', TemplateParam: '{"code":"123456"}' },
    version: '2017-05-25',
    ...overrides,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signAliyunRequest', () => {
  it('signs the request headers with the ACS3 scheme', () => {
    const { headers } = request();

    expect(headers.authorization).toMatch(
      /^ACS3-HMAC-SHA256 Credential=LTAI-test,SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=[\da-f]{64}$/,
    );
    // sha256 of the empty body
    expect(headers['x-acs-content-sha256']).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('puts the query in sorted, RFC 3986 encoded form', () => {
    expect(request({ query: { b: 'x y*', a: "it's" } }).url).toBe(
      'https://dysmsapi.aliyuncs.com/?a=it%27s&b=x%20y%2A',
    );
  });

  it('changes the signature with any signed input', () => {
    const signature = (overrides: Partial<Parameters<typeof signAliyunRequest>[0]>) =>
      request(overrides).headers.authorization.split('Signature=')[1];

    expect(signature({})).toBe(signature({}));
    expect(signature({ accessKeySecret: 'other' })).not.toBe(signature({}));
    expect(signature({ nonce: 'nonce-2' })).not.toBe(signature({}));
    expect(signature({ query: { PhoneNumbers: '13900139000' } })).not.toBe(signature({}));
  });
});

describe('sendAliyunVerificationCode', () => {
  const config = {
    accessKeyId: 'LTAI-test',
    accessKeySecret: 'secret-test',
    signName: 'Biber',
    templateCode: 'SMS_1',
  };

  it('sends the code to the national number with the approved signature and template', async () => {
    const fetchMock = vi.fn(async () => Response.json({ Code: 'OK' }));
    vi.stubGlobal('fetch', fetchMock);

    await sendAliyunVerificationCode(config, '+8613800138000', '123456');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const query = new URL(url).searchParams;
    expect(init.method).toBe('POST');
    expect(query.get('PhoneNumbers')).toBe('13800138000');
    expect(query.get('SignName')).toBe('Biber');
    expect(query.get('TemplateCode')).toBe('SMS_1');
    expect(JSON.parse(query.get('TemplateParam')!)).toEqual({ code: '123456' });
  });

  it('fails when Alibaba Cloud does not accept the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ Code: 'isv.BUSINESS_LIMIT_CONTROL', Message: 'limit' })),
    );

    await expect(sendAliyunVerificationCode(config, '+8613800138000', '1')).rejects.toThrow(
      'isv.BUSINESS_LIMIT_CONTROL',
    );
  });
});
