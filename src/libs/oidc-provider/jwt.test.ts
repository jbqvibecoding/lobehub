import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/auth', () => ({
  authEnv: {
    JWKS_KEY: JSON.stringify({
      keys: [
        {
          alg: 'RS256',
          e: 'AQAB',
          kid: 'test-key',
          kty: 'RSA',
          n: 'test-modulus',
          use: 'sig',
        },
      ],
    }),
  },
}));

const importJWKMock = vi.fn();
const jwtVerifyMock = vi.fn();

vi.mock('jose', () => ({
  importJWK: (...args: unknown[]) => importJWKMock(...args),
  jwtVerify: (...args: unknown[]) => jwtVerifyMock(...args),
}));

describe('validateOIDCJWT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    importJWKMock.mockResolvedValue('public-key');
  });

  it('should preserve the original jose error as TRPCError cause', async () => {
    const joseError = Object.assign(new Error('"exp" claim timestamp check failed'), {
      code: 'ERR_JWT_EXPIRED',
    });
    jwtVerifyMock.mockRejectedValueOnce(joseError);

    const { validateOIDCJWT } = await import('./jwt');

    await expect(validateOIDCJWT('header.payload.signature')).rejects.toMatchObject({
      cause: joseError,
      code: 'UNAUTHORIZED',
    });
  });

  it('should not wrap JWKS/public key retrieval failures as TRPCError', async () => {
    importJWKMock.mockRejectedValueOnce(new Error('invalid JWK'));

    const { validateOIDCJWT } = await import('./jwt');

    const error = await validateOIDCJWT('header.payload.signature').catch((error_) => error_);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TRPCError);
    expect((error as Error).message).toBe('JWKS_KEY public key retrieval failed: invalid JWK');
  });

  it('refuses a run token unless the caller accepts them, and keeps the run it names', async () => {
    for (const purpose of ['hetero-run', 'hetero-operation']) {
      jwtVerifyMock.mockResolvedValue({
        payload: { op: 'op-1', purpose, sub: 'user-1', topic: 'tpc-1' },
      });
      const { validateOIDCJWT } = await import('./jwt');

      await expect(validateOIDCJWT('header.payload.signature')).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      const accepted = await validateOIDCJWT('header.payload.signature', { allowRunTokens: true });
      expect(accepted.tokenData).toMatchObject({
        op: 'op-1',
        purpose,
        sub: 'user-1',
        topic: 'tpc-1',
      });
    }
  });

  it('accepts a user token wherever it is used', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { purpose: 'cli-sandbox', sub: 'user-1' } });
    const { validateOIDCJWT } = await import('./jwt');

    await expect(validateOIDCJWT('header.payload.signature')).resolves.toMatchObject({
      userId: 'user-1',
    });
  });
});
