import { lambdaClient } from '@/libs/trpc/client';

type CheckoutParams = Parameters<typeof lambdaClient.subscription.createCheckout.mutate>[0];

class SubscriptionService {
  getStatus = async () => lambdaClient.subscription.status.query();

  getPrices = async () => lambdaClient.subscription.prices.query();

  createCheckout = async (params: CheckoutParams) =>
    lambdaClient.subscription.createCheckout.mutate(params);

  createPortal = async () => lambdaClient.subscription.createPortal.mutate();

  refresh = async () => lambdaClient.subscription.refresh.mutate();
}

export const subscriptionService = new SubscriptionService();
