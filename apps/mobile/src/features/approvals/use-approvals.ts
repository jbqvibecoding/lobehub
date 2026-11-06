import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { activityKey } from '@/features/activity/use-activity';
import type { ApiClient } from '@/lib/api-client';
import { apiErrorCode } from '@/lib/api-client';

import type { ApprovalDecision, PendingApproval } from './types';

export const pendingApprovalsKey = ['approvals', 'pending'] as const;

export const usePendingApprovals = (api: ApiClient) =>
  useQuery({
    queryFn: () => api.query('approval.listPending', undefined) as Promise<PendingApproval[]>,
    queryKey: pendingApprovalsKey,
  });

export interface RespondInput {
  decision: ApprovalDecision;
  reason?: string;
  toolMessageId: string;
}

/**
 * Answers one approval. Another device answering first is not a failure the user can fix, so a
 * CONFLICT resolves as `alreadyAnswered` and the list refreshes either way.
 */
export const useRespondToApproval = (api: ApiClient) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RespondInput): Promise<{ alreadyAnswered: boolean }> => {
      try {
        await api.mutation('approval.respond', input);
        return { alreadyAnswered: false };
      } catch (error) {
        if (apiErrorCode(error) === 'CONFLICT') return { alreadyAnswered: true };
        throw error;
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: pendingApprovalsKey }),
        queryClient.invalidateQueries({ queryKey: activityKey }),
      ]),
  });
};
