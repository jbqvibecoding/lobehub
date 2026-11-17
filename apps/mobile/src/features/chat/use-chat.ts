import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ApiClient } from '@/lib/api-client';

import type { ChatHistory, RecentConversation } from './types';

export const conversationsKey = ['chat', 'conversations'] as const;
export const chatHistoryKey = (topicId: string) => ['chat', 'history', topicId] as const;

/** How often an open conversation looks for news while its run writes, and while it waits. */
const WHILE_RUNNING_MS = 1500;
const WHILE_WAITING_MS = 5000;
/** A message just sent may be read before its run has started; look again for this long. */
const REPLY_GRACE_MS = 2 * 60 * 1000;

const awaitsReply = (history: ChatHistory | undefined) => {
  const last = history?.lines.at(-1);
  return last?.kind === 'user' && Date.now() - new Date(last.createdAt).getTime() < REPLY_GRACE_MS;
};

export const useConversations = (api: ApiClient) =>
  useQuery({
    queryFn: async () =>
      ((await api.query('topic.recentTopics', { limit: 30 })) as RecentConversation[]).filter(
        (conversation) => conversation.type === 'agent',
      ),
    queryKey: conversationsKey,
  });

/**
 * An open conversation. It refreshes itself while its run writes, and more slowly while a call
 * waits for an answer that may come from another device; once the run is done it stops.
 */
export const useChatHistory = (api: ApiClient, topicId: string | undefined) =>
  useQuery({
    enabled: !!topicId,
    queryFn: () => api.query('chat.history', { topicId }) as Promise<ChatHistory>,
    queryKey: chatHistoryKey(topicId ?? ''),
    refetchInterval: (query) => {
      const history = query.state.data;
      if (history?.run === 'running' || awaitsReply(history)) return WHILE_RUNNING_MS;
      if (history?.run === 'waiting') return WHILE_WAITING_MS;
      return false;
    },
  });

export const useSendMessage = (api: ApiClient) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { text: string; topicId?: string }) =>
      api.mutation('chat.send', input) as Promise<{ operationId: string; topicId: string }>,
    onSuccess: ({ topicId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: chatHistoryKey(topicId) }),
        queryClient.invalidateQueries({ queryKey: conversationsKey }),
      ]),
  });
};

export const useStopRun = (api: ApiClient) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (topicId: string) =>
      api.mutation('chat.stop', { topicId }) as Promise<{ stopped: boolean }>,
    onSettled: (_result, _error, topicId) =>
      queryClient.invalidateQueries({ queryKey: chatHistoryKey(topicId) }),
  });
};
