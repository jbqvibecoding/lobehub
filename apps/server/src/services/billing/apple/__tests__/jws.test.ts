// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { AppleJwsError, parseAppleRoots, verifyAppleJws } from '../jws';
import { OTHER_ROOT, signLikeApple, TEST_ROOT, testRoots } from './fixtures';

const payload = { productId: 'ai.biber.premium.monthly', transactionId: '2000000456' };

describe('verifyAppleJws', () => {
  it('returns the content of a payload signed under a trusted root', () => {
    expect(verifyAppleJws(signLikeApple(payload), { roots: testRoots })).toEqual(payload);
  });

  it('refuses a payload whose content was changed after signing', () => {
    const [header, , signature] = signLikeApple(payload).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...payload, productId: 'ai.biber.ultimate.yearly' }),
    ).toString('base64url');

    expect(() => verifyAppleJws(`${header}.${forged}.${signature}`, { roots: testRoots })).toThrow(
      'Signature does not match',
    );
  });

  it('refuses a chain that does not end at a trusted root', () => {
    expect(() =>
      verifyAppleJws(signLikeApple(payload), { roots: [Buffer.from(OTHER_ROOT, 'base64')] }),
    ).toThrow('Not signed under a trusted Apple root certificate');
  });

  it("refuses a signer without Apple's App Store marker, even under the trusted root", () => {
    expect(() =>
      verifyAppleJws(signLikeApple(payload, { unmarked: true }), { roots: testRoots }),
    ).toThrow('Certificates are not marked for App Store data');
  });

  it('refuses certificates outside their validity and other algorithms', () => {
    expect(() =>
      verifyAppleJws(signLikeApple(payload), { now: new Date('2100-01-01'), roots: testRoots }),
    ).toThrow(AppleJwsError);
    expect(() =>
      verifyAppleJws(signLikeApple(payload, { alg: 'none' }), { roots: testRoots }),
    ).toThrow('Unexpected algorithm none');
    expect(() => verifyAppleJws('not-a-jws', { roots: testRoots })).toThrow(AppleJwsError);
  });

  it('reads configured roots as comma-separated base64 DER', () => {
    expect(parseAppleRoots(` ${TEST_ROOT} , ${OTHER_ROOT}`)).toHaveLength(2);
    expect(parseAppleRoots(undefined)).toEqual([]);
  });
});
