import { createHash, createHmac, randomUUID } from 'node:crypto';

const ENDPOINT = 'dysmsapi.aliyuncs.com';
const ALGORITHM = 'ACS3-HMAC-SHA256';

export interface AliyunSmsConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
}

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

/** RFC 3986 percent-encoding, as Alibaba Cloud's canonical query string requires. */
const percentEncode = (value: string) =>
  encodeURIComponent(value).replaceAll(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * Signs an Alibaba Cloud API request with the V3 scheme (ACS3-HMAC-SHA256): a canonical request
 * of method, path, sorted query, the signed headers and the body hash, hashed and signed with
 * the AccessKey secret.
 */
export const signAliyunRequest = ({
  accessKeyId,
  accessKeySecret,
  action,
  body = '',
  date,
  nonce,
  query,
  version,
}: {
  accessKeyId: string;
  accessKeySecret: string;
  action: string;
  body?: string;
  date: string;
  nonce: string;
  query: Record<string, string>;
  version: string;
}) => {
  const headers: Record<string, string> = {
    'host': ENDPOINT,
    'x-acs-action': action,
    'x-acs-content-sha256': sha256Hex(body),
    'x-acs-date': date,
    'x-acs-signature-nonce': nonce,
    'x-acs-version': version,
  };
  const signedHeaders = Object.keys(headers).sort();
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(query[key])}`)
    .join('&');
  const canonicalRequest = [
    'POST',
    '/',
    canonicalQuery,
    ...signedHeaders.map((name) => `${name}:${headers[name].trim()}`),
    '',
    signedHeaders.join(';'),
    headers['x-acs-content-sha256'],
  ].join('\n');
  const signature = createHmac('sha256', accessKeySecret)
    .update(`${ALGORITHM}\n${sha256Hex(canonicalRequest)}`)
    .digest('hex');

  const signed: Record<string, string> = {
    ...headers,
    authorization: `${ALGORITHM} Credential=${accessKeyId},SignedHeaders=${signedHeaders.join(';')},Signature=${signature}`,
  };
  return {
    headers: signed,
    url: `https://${ENDPOINT}/?${canonicalQuery}`,
  };
};

/**
 * Sends a verification code with Alibaba Cloud SMS (`SendSms`). The phone number is given without
 * the country code for mainland numbers, as the service expects.
 */
export const sendAliyunVerificationCode = async (
  config: AliyunSmsConfig,
  phoneNumber: string,
  code: string,
) => {
  const { headers, url } = signAliyunRequest({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    action: 'SendSms',
    date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    nonce: randomUUID(),
    query: {
      PhoneNumbers: phoneNumber.replace(/^\+86/, ''),
      SignName: config.signName,
      TemplateCode: config.templateCode,
      TemplateParam: JSON.stringify({ code }),
    },
    version: '2017-05-25',
  });

  const response = await fetch(url, { headers, method: 'POST' });
  const data = (await response.json().catch(() => ({}))) as { Code?: string; Message?: string };
  if (!response.ok || data.Code !== 'OK') {
    throw new Error(
      `Aliyun SMS failed: ${data.Code ?? response.status} ${data.Message ?? ''}`.trim(),
    );
  }
};
