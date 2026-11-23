import { TRPCError } from '@trpc/server';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { GithubConnectionError, GithubConnectionService } from '@/server/services/githubApp';

const githubProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) =>
  opts.next({
    ctx: { github: new GithubConnectionService(opts.ctx.serverDB, opts.ctx.userId) },
  }),
);

const asTrpcError = (error: unknown) => {
  if (!(error instanceof GithubConnectionError)) return error;
  const code =
    error.code === 'NOT_CONFIGURED'
      ? 'PRECONDITION_FAILED'
      : error.code === 'NOT_CONNECTED'
        ? 'NOT_FOUND'
        : error.code;
  return new TRPCError({ code, message: error.message });
};

/**
 * "Account → GitHub" on the phone: whether the deployment has a GitHub App, the account the user
 * connected and the repositories they gave Biber, the page to install the App on, and
 * disconnecting. Pushes are approved in the approval list like any other call.
 */
export const githubRouter = router({
  connectUrl: githubProcedure
    .use(withScopedPermission('message:create'))
    .mutation(async ({ ctx }) => {
      try {
        return { url: await ctx.github.connectUrl() };
      } catch (error) {
        throw asTrpcError(error);
      }
    }),

  disconnect: githubProcedure
    .use(withScopedPermission('message:create'))
    .mutation(async ({ ctx }) => ({ disconnected: await ctx.github.disconnect() })),

  status: githubProcedure.query(async ({ ctx }) => ctx.github.status()),
});
