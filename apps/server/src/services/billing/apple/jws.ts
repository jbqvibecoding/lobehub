import { verify, X509Certificate } from 'node:crypto';

/** Why a signed App Store payload was refused. */
export class AppleJwsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppleJwsError';
  }
}

/** An OID as DER bytes (tag, length, value), to find a certificate extension by its id. */
const encodeOid = (oid: string) => {
  const [first, second, ...rest] = oid.split('.').map(Number);
  const body = [40 * first + second];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let value = arc >> 7; value > 0; value >>= 7) chunk.unshift((value & 0x7f) | 0x80);
    body.push(...chunk);
  }
  return Buffer.from([0x06, body.length, ...body]);
};

/** Apple marks the certificate that signs App Store data, and the WWDR intermediate above it. */
const SIGNER_MARKER = encodeOid('1.2.840.113635.100.6.11.1');
const INTERMEDIATE_MARKER = encodeOid('1.2.840.113635.100.6.2.1');

const decodePart = (part: string) => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new AppleJwsError('Malformed signed payload');
  }
};

const isValidAt = (certificate: X509Certificate, at: Date) =>
  new Date(certificate.validFrom) <= at && at <= new Date(certificate.validTo);

/**
 * Verifies an App Store signed payload (a transaction, renewal info or server notification) and
 * returns its content. The payload is a compact JWS signed with ES256 by the first certificate
 * of its `x5c` chain; the chain must run, signature by signature, to one of `roots`, and carry
 * Apple's marker extensions, as Apple's own App Store Server Library checks.
 */
export const verifyAppleJws = <T>(
  jws: string,
  { now = new Date(), roots }: { now?: Date; roots: Buffer[] },
): T => {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new AppleJwsError('Not a compact JWS');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  const header = decodePart(encodedHeader);
  if (header.alg !== 'ES256') throw new AppleJwsError(`Unexpected algorithm ${header.alg}`);
  if (!Array.isArray(header.x5c) || header.x5c.length !== 3) {
    throw new AppleJwsError('Expected a three-certificate chain');
  }

  let chain: X509Certificate[];
  try {
    chain = header.x5c.map((der: string) => new X509Certificate(Buffer.from(der, 'base64')));
  } catch {
    throw new AppleJwsError('Malformed certificate chain');
  }
  const [signer, intermediate, root] = chain;

  if (!roots.some((trusted) => trusted.equals(root.raw))) {
    throw new AppleJwsError('Not signed under a trusted Apple root certificate');
  }
  if (!intermediate.ca || !intermediate.checkIssued(root) || !intermediate.verify(root.publicKey)) {
    throw new AppleJwsError('Intermediate certificate not issued by the root');
  }
  if (!signer.checkIssued(intermediate) || !signer.verify(intermediate.publicKey)) {
    throw new AppleJwsError('Signing certificate not issued by the intermediate');
  }
  if (!intermediate.raw.includes(INTERMEDIATE_MARKER) || !signer.raw.includes(SIGNER_MARKER)) {
    throw new AppleJwsError('Certificates are not marked for App Store data');
  }
  if (!chain.every((certificate) => isValidAt(certificate, now))) {
    throw new AppleJwsError('A certificate in the chain is not valid now');
  }

  const signed = verify(
    'sha256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    { dsaEncoding: 'ieee-p1363', key: signer.publicKey },
    Buffer.from(encodedSignature, 'base64url'),
  );
  if (!signed) throw new AppleJwsError('Signature does not match');

  return decodePart(encodedPayload) as T;
};

/** Root certificates from `APPLE_ROOT_CERTIFICATES`: base64 DER, comma-separated. */
export const parseAppleRoots = (value: string | undefined): Buffer[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => new X509Certificate(Buffer.from(item, 'base64')).raw);
