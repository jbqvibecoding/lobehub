import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import type { ReactNode } from 'react';

import { showApprovalNotice, useApprovalNotice } from '@/features/approvals/approval-notice';
import { api } from '@/lib/api';

import { useNotificationRouting } from './use-notification-routing';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(async () => ({ success: true })),
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
}));
jest.mock('@/lib/api', () => ({ api: { mutation: jest.fn(async () => null), query: jest.fn() } }));
jest.mock('expo-notifications', () => {
  const listeners: Record<string, (value: unknown) => void> = {};
  return {
    __emit: (name: string, value: unknown) => listeners[name]?.(value),
    addNotificationReceivedListener: jest.fn((listener) => {
      listeners.received = listener;
      return { remove: jest.fn() };
    }),
    addNotificationResponseReceivedListener: jest.fn((listener) => {
      listeners.response = listener;
      return { remove: jest.fn() };
    }),
    clearLastNotificationResponse: jest.fn(),
    getLastNotificationResponse: jest.fn(() => null),
    setNotificationCategoryAsync: jest.fn(async () => null),
    setNotificationHandler: jest.fn(),
  };
});

let nextId = 0;
const tap = (actionIdentifier: string, toolMessageId = 'tool-1') =>
  ({
    actionIdentifier,
    notification: {
      request: {
        content: { body: 'Send email · gmail-mcp', data: { toolMessageId } },
        identifier: `notification-${(nextId += 1)}`,
      },
    },
  }) as unknown as Notifications.NotificationResponse;

const emitTap = (response: Notifications.NotificationResponse) =>
  act(() => (Notifications as any).__emit('response', response));

const renderRouting = async (signedIn: boolean | undefined) => {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    ({ signedIn: current }: { signedIn: boolean | undefined }) => {
      useNotificationRouting(current);
      return useApprovalNotice();
    },
    { initialProps: { signedIn }, wrapper },
  );
};

beforeEach(() => {
  jest.clearAllMocks();
});

// Clears the notice and its timer, so no test leaves one running
afterEach(() => act(() => showApprovalNotice(null)));

describe('useNotificationRouting', () => {
  it('registers the Approve / Reject category', async () => {
    await renderRouting(true);

    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
      'approval',
      expect.any(Array),
    );
  });

  it('opens the list on a tap on the notification itself, without answering', async () => {
    await renderRouting(true);

    await emitTap(tap('expo.modules.notifications.actions.DEFAULT'));

    expect(router.navigate).toHaveBeenCalledWith('/');
    expect(api.mutation).not.toHaveBeenCalled();
  });

  it('answers a tap on Reject and says so above the list', async () => {
    const { result } = await renderRouting(true);

    await emitTap(tap('reject', 'tool-7'));

    await waitFor(() =>
      expect(api.mutation).toHaveBeenCalledWith('approval.respond', {
        decision: 'rejected',
        toolMessageId: 'tool-7',
      }),
    );
    await waitFor(() => expect(result.current).toBe('Rejected: Send email · gmail-mcp'));
  });

  it('answers the tap that launched the app once, then forgets it', async () => {
    const launchedBy = tap('approve', 'tool-3');
    jest.mocked(Notifications.getLastNotificationResponse).mockReturnValueOnce(launchedBy);

    await renderRouting(true);
    await emitTap(launchedBy);

    await waitFor(() => expect(api.mutation).toHaveBeenCalledTimes(1));
    expect(api.mutation).toHaveBeenCalledWith('approval.respond', {
      decision: 'approved',
      toolMessageId: 'tool-3',
    });
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
  });

  it('waits for the stored session before answering, and drops the tap when signed out', async () => {
    const { rerender } = await renderRouting(undefined);
    await emitTap(tap('reject', 'tool-4'));
    expect(api.mutation).not.toHaveBeenCalled();

    await rerender({ signedIn: true });
    await waitFor(() =>
      expect(api.mutation).toHaveBeenCalledWith('approval.respond', {
        decision: 'rejected',
        toolMessageId: 'tool-4',
      }),
    );

    jest.mocked(api.mutation).mockClear();
    const signedOut = await renderRouting(undefined);
    await emitTap(tap('reject', 'tool-5'));
    await signedOut.rerender({ signedIn: false });
    expect(api.mutation).not.toHaveBeenCalled();
  });
});
