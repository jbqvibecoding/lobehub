import { TRPCError } from '@trpc/server';

import { isRunTokenPurpose } from '@/libs/oidc-provider/jwt';

import { trpc } from '../init';

export const oidcAuth = trpc.middleware(async (opts) => {
  const { ctx, next } = opts;

  // Check OIDC authentication
  if (ctx.oidcAuth) {
    // Run tokens (hetero-operation, hetero-run) are long-lived (4h) and scoped exclusively to
    // the endpoints a run streams back through. Reject them here so a leaked sandbox JWT
    // cannot be replayed against any other authed route.
    if (isRunTokenPurpose(ctx.oidcAuth.purpose)) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: `${ctx.oidcAuth.purpose} tokens are not accepted on this endpoint`,
      });
    }

    return next({
      ctx: { oidcAuth: ctx.oidcAuth, userId: ctx.oidcAuth.sub },
    });
  }

  return next();
});
