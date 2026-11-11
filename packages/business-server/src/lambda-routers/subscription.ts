import { Plans } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { BillingError, type BillingErrorCode, BillingService } from '@/server/services/billing';

/** Plans are personal: they follow the user across workspaces. */
export const billingProcedure = authedProcedure
  .use(serverDatabase)
  .use(async (opts) =>
    opts.next({ ctx: { billing: new BillingService(opts.ctx.serverDB, opts.ctx.userId) } }),
  );

const TRPC_CODE: Record<BillingErrorCode, TRPCError['code']> = {
  ALREADY_SUBSCRIBED: 'CONFLICT',
  NO_CUSTOMER: 'NOT_FOUND',
  NOT_FOR_SALE: 'BAD_REQUEST',
  UNAVAILABLE: 'PRECONDITION_FAILED',
};

const answering = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BillingError) {
      throw new TRPCError({ code: TRPC_CODE[error.code], message: error.message });
    }
    throw error;
  }
};

export const subscriptionRouter = router({
  /** Stripe's billing portal, to change plan, update the card, cancel or get invoices. */
  createPortal: billingProcedure.mutation(async ({ ctx }) => ({
    url: await answering(() => ctx.billing.createPortalUrl()),
  })),

  /** Stripe Checkout for a paid plan; the user returns to `/settings/plans?checkout=…`. */
  createCheckout: billingProcedure
    .input(
      z.object({
        interval: z.enum(['monthly', 'yearly']),
        plan: z.enum([Plans.Starter, Plans.Premium, Plans.Ultimate]),
      }),
    )
    .mutation(async ({ ctx, input }) => ({
      url: await answering(() => ctx.billing.createCheckoutUrl(input)),
    })),

  /** Re-reads the subscription from the provider, e.g. right after returning from Checkout. */
  refresh: billingProcedure.mutation(({ ctx }) => ctx.billing.refresh()),

  status: billingProcedure.query(({ ctx }) => ctx.billing.getStatus()),
});
