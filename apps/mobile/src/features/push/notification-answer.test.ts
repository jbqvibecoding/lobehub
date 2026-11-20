import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';

import {
  answerFromNotification,
  readNotificationAnswer,
  registerApprovalCategory,
  syncNotificationTray,
} from './notification-answer';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(async () => ({ success: true })),
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
}));
jest.mock('expo-notifications', () => ({
  dismissAllNotificationsAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  setBadgeCountAsync: jest.fn(),
  setNotificationCategoryAsync: jest.fn(async () => null),
}));

const tapOn = (actionIdentifier: string, data: Record<string, unknown> = {}) =>
  ({
    actionIdentifier,
    notification: {
      request: {
        content: { body: 'Send email · gmail-mcp', data, title: 'Waiting for you' },
        identifier: 'notification-1',
      },
    },
  }) as unknown as Notifications.NotificationResponse;

const presented = (identifier: string, data: Record<string, unknown>) => ({
  request: { content: { data }, identifier },
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('registerApprovalCategory', () => {
  it('puts Approve and Reject on the notification, both opening the app', async () => {
    await registerApprovalCategory();

    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith('approval', [
      {
        buttonTitle: 'Approve',
        identifier: 'approve',
        options: { isAuthenticationRequired: true, opensAppToForeground: true },
      },
      {
        buttonTitle: 'Reject',
        identifier: 'reject',
        options: { isDestructive: true, opensAppToForeground: true },
      },
    ]);
  });
});

describe('readNotificationAnswer', () => {
  it('reads the decision and the call from a button tap', () => {
    expect(readNotificationAnswer(tapOn('approve', { toolMessageId: 'tool-1' }))).toEqual({
      decision: 'approved',
      title: 'Send email · gmail-mcp',
      toolMessageId: 'tool-1',
    });
    expect(readNotificationAnswer(tapOn('reject', { toolMessageId: 'tool-1' }))?.decision).toBe(
      'rejected',
    );
  });

  it('answers nothing for a tap on the notification itself, or without a call', () => {
    expect(
      readNotificationAnswer(
        tapOn('expo.modules.notifications.actions.DEFAULT', { toolMessageId: 'tool-1' }),
      ),
    ).toBeNull();
    expect(readNotificationAnswer(tapOn('approve'))).toBeNull();
  });
});

describe('answerFromNotification', () => {
  const approve = { decision: 'approved' as const, title: 'Send email', toolMessageId: 'tool-1' };
  const reject = { ...approve, decision: 'rejected' as const };

  it('asks for Face ID before approving', async () => {
    const respond = jest.fn(async () => ({ alreadyAnswered: false }));

    expect(await answerFromNotification(approve, respond)).toBe('answered');
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({ decision: 'approved', toolMessageId: 'tool-1' });
  });

  it('does not approve when Face ID is cancelled', async () => {
    jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValueOnce({
      error: 'user_cancel',
      success: false,
    });
    const respond = jest.fn();

    expect(await answerFromNotification(approve, respond)).toBe('cancelled');
    expect(respond).not.toHaveBeenCalled();
  });

  it('rejects without asking for Face ID', async () => {
    const respond = jest.fn(async () => ({ alreadyAnswered: false }));

    expect(await answerFromNotification(reject, respond)).toBe('answered');
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
  });

  it('reports an answer given elsewhere first, and a failed one', async () => {
    expect(await answerFromNotification(reject, async () => ({ alreadyAnswered: true }))).toBe(
      'alreadyAnswered',
    );
    expect(
      await answerFromNotification(reject, async () => {
        throw new Error('offline');
      }),
    ).toBe('failed');
  });
});

describe('syncNotificationTray', () => {
  it('removes notifications of calls that no longer wait, and badges the count', async () => {
    jest
      .mocked(Notifications.getPresentedNotificationsAsync)
      .mockResolvedValueOnce([
        presented('n-answered', { toolMessageId: 'tool-gone' }),
        presented('n-waiting', { toolMessageId: 'tool-1' }),
        presented('n-several', { notificationId: 'x' }),
      ] as any);

    await syncNotificationTray([{ id: 'tool-1' }, { id: 'tool-2' }]);

    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('n-answered');
    expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(2);
  });

  it('clears the approvals and the badge once nothing waits, but keeps other messages', async () => {
    jest
      .mocked(Notifications.getPresentedNotificationsAsync)
      .mockResolvedValueOnce([
        presented('n-answered', { kind: 'approval', toolMessageId: 'tool-gone' }),
        presented('n-several', { kind: 'approval', notificationId: 'x' }),
        presented('n-old', { notificationId: 'y' }),
        presented('n-brief', { kind: 'routine', outcomeId: 'o-1', taskId: 'task-1' }),
        presented('n-nudge', { kind: 'proactive', outcomeId: 'o-2', topicId: 'topic-1' }),
      ] as any);

    await syncNotificationTray([]);

    expect(
      jest.mocked(Notifications.dismissNotificationAsync).mock.calls.map(([id]) => id),
    ).toEqual(['n-answered', 'n-several', 'n-old']);
    expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(0);
  });
});
