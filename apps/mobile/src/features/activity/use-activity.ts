import { useInfiniteQuery } from '@tanstack/react-query';

import type { ApiClient } from '@/lib/api-client';

import type { ActivityPage } from './types';

export const activityKey = ['activity'] as const;

/** The trail, newest first, a page at a time. */
export const useActivity = (api: ApiClient) =>
  useInfiniteQuery({
    getNextPageParam: (lastPage: ActivityPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.query('activity.list', { cursor: pageParam }) as Promise<ActivityPage>,
    queryKey: activityKey,
  });
