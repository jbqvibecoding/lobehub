import { describe, expect, it } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { trpc } from '@/libs/trpc/lambda/init';

import { heteroOperationAuth } from '../heteroOperationAuth';

// Minimal router that exercises heteroOperationAuth
const testRouter = trpc.router({
  ping: trpc.procedure.use(heteroOperationAuth).query(({ ctx }) => ({
    kind: (ctx as any).heteroAuthKind,
    scope: (ctx as any).heteroRunScope,
    userId: ctx.userId,
  })),
});

const createCaller = createCallerFactory(testRouter);

describe('heteroOperationAuth middleware', () => {
  it('accepts a hetero-operation token as kind "operation"', async () => {
    const caller = createCaller({
      oidcAuth: { purpose: 'hetero-operation', sub: 'user-abc' },
    } as any);

    const result = await caller.ping();

    expect(result).toEqual({ kind: 'operation', scope: undefined, userId: 'user-abc' });
  });

  it('accepts a normal user OIDC token (no purpose) as kind "user"', async () => {
    const caller = createCaller({
      oidcAuth: { sub: 'user-abc' },
    } as any);

    const result = await caller.ping();

    expect(result).toEqual({ kind: 'user', scope: undefined, userId: 'user-abc' });
  });

  it('accepts a cli-sandbox token as kind "user"', async () => {
    const caller = createCaller({
      oidcAuth: { purpose: 'cli-sandbox', sub: 'user-abc' },
    } as any);

    const result = await caller.ping();

    expect(result).toEqual({ kind: 'user', scope: undefined, userId: 'user-abc' });
  });

  it('accepts a hetero-run token as kind "run", scoped to its run', async () => {
    const caller = createCaller({
      oidcAuth: { op: 'op-1', purpose: 'hetero-run', sub: 'user-abc', topic: 'tpc-1' },
    } as any);

    expect(await caller.ping()).toEqual({
      kind: 'run',
      scope: { operationId: 'op-1', topicId: 'tpc-1' },
      userId: 'user-abc',
    });
  });

  it('rejects a hetero-run token that names no run', async () => {
    const caller = createCaller({
      oidcAuth: { purpose: 'hetero-run', sub: 'user-abc' },
    } as any);

    await expect(caller.ping()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects when oidcAuth is absent', async () => {
    const caller = createCaller({} as any);

    await expect(caller.ping()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects when oidcAuth has no sub', async () => {
    const caller = createCaller({
      oidcAuth: { purpose: 'hetero-operation' },
    } as any);

    await expect(caller.ping()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
