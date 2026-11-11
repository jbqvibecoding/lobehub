import { router } from '@/libs/trpc/lambda';

import { billingProcedure } from '../lambda-routers/subscription';

/**
 * The phone only shows the plan. Buying in the app has to go through the App Store or Google
 * Play, so a phone purchase arrives with in-app purchase support, not through Stripe here.
 */
export const mobileSubscriptionRouter = router({
  status: billingProcedure.query(({ ctx }) => ctx.billing.getStatus()),
});
