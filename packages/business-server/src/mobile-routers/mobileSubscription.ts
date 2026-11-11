import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { answering, billingProcedure } from '../lambda-routers/subscription';

/**
 * The phone shows the plan and sells through the App Store. Stripe stays on the web: buying in
 * the app has to go through the store.
 */
export const mobileSubscriptionRouter = router({
  /** The token to attach to an App Store purchase (`appAccountToken`). */
  appleAccountToken: billingProcedure.mutation(async ({ ctx }) => ({
    token: await answering(() => ctx.billing.appleAccountToken()),
  })),

  /** The App Store products that sell each paid plan. */
  appleProducts: billingProcedure.query(({ ctx }) => ctx.billing.appleProducts()),

  status: billingProcedure.query(({ ctx }) => ctx.billing.getStatus()),

  /**
   * Records App Store transactions the phone received, signed by Apple: after a purchase, a
   * restore, or on launch to pick up renewals. Returns the updated status.
   */
  syncApplePurchases: billingProcedure
    .input(z.object({ signedTransactions: z.array(z.string().min(1)).min(1).max(20) }))
    .mutation(({ ctx, input }) =>
      answering(() => ctx.billing.syncApplePurchases(input.signedTransactions)),
    ),
});
