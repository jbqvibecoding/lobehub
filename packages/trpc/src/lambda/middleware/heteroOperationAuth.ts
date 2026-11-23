import { TRPCError } from '@trpc/server';

import { trpc } from '../init';

/**
 * Auth middleware for hetero-agent ingest/finish endpoints. Accepts two callers:
 *
 * - A `hetero-operation` token (4h expiry) — the narrow, server-minted JWT
 *   issued by execAgent for the cloud sandbox / workspace device. Its `sub` may
 *   be a userId or, for workspace runs, a workspaceId. Behaves exactly as before.
 * - A normal user OIDC token — a logged-in desktop reusing its own session for a
 *   remote run dispatched to it, so the spawned `lh hetero exec` can stream
 *   results back without a server round-trip to mint a dedicated token.
 *
 * The owner-token path is safe because heteroIngest / heteroFinish additionally
 * gate every write on `topics.userId === ctx.userId` (see the `heteroAuthKind`
 * ownership check in the handlers), so an owner token can only touch its own
 * running operation — it cannot reach another user's topic.
 *
 * - A `hetero-run` token (Biber's cloud sandbox runs): like an operation token, but it names its
 *   run and conversation (`heteroRunScope`), and handlers refuse it for any other run.
 *
 * `heteroAuthKind` is forwarded so handlers can apply the strict ownership guard
 * to owner tokens only, while leaving the operation-token path (whose `sub` may
 * be a workspaceId that never matches `topics.userId`) untouched.
 */
export const heteroOperationAuth = trpc.middleware(async (opts) => {
  const { ctx, next } = opts;

  const sub = ctx.oidcAuth?.sub as string | undefined;
  if (!ctx.oidcAuth || !sub) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'This endpoint requires an authenticated token',
    });
  }

  const purpose = ctx.oidcAuth.purpose;
  const heteroAuthKind: 'operation' | 'run' | 'user' =
    purpose === 'hetero-run' ? 'run' : purpose === 'hetero-operation' ? 'operation' : 'user';

  // A `hetero-run` token names the one run it is for; handlers hold every call to it
  const runScope =
    heteroAuthKind === 'run'
      ? { operationId: ctx.oidcAuth.op as string, topicId: ctx.oidcAuth.topic as string }
      : undefined;
  if (runScope && (!runScope.operationId || !runScope.topicId)) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'The run token names no run' });
  }

  return next({
    ctx: { heteroAuthKind, heteroRunScope: runScope, oidcAuth: ctx.oidcAuth, userId: sub },
  });
});
