import { useQuery } from '@tanstack/react-query';

import type { ApiClient } from '@/lib/api-client';

import type { PlanStatus } from './types';

export const planKey = ['subscription', 'status'] as const;

/** The signed-in user's plan and this month's credits. */
export const usePlan = (api: ApiClient) =>
  useQuery({
    queryFn: () => api.query('subscription.status') as Promise<PlanStatus>,
    queryKey: planKey,
  });
