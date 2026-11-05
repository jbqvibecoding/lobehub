import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import { ApprovalCard } from './approval-card';
import type { PendingApproval } from './types';

jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(),
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
}));

const biometrics = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;

const approval: PendingApproval = {
  apiName: 'send_email',
  arguments: JSON.stringify({ subject: 'Invoice', to: 'ana@example.com' }),
  createdAt: new Date('2026-11-05T10:00:00Z'),
  id: 'tool-1',
  identifier: 'gmail-mcp',
  type: 'mcp',
};

const enrolled = (success: boolean) => {
  biometrics.hasHardwareAsync.mockResolvedValue(true);
  biometrics.isEnrolledAsync.mockResolvedValue(true);
  biometrics.authenticateAsync.mockResolvedValue(
    success ? { success: true } : { error: 'user_cancel', success: false },
  );
};

describe('ApprovalCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows exactly what the agent wants to do', async () => {
    await render(<ApprovalCard approval={approval} onRespond={jest.fn()} />);

    expect(screen.getByText('Send email')).toBeOnTheScreen();
    expect(screen.getByText('gmail-mcp')).toBeOnTheScreen();
    expect(screen.getByText('ana@example.com')).toBeOnTheScreen();
  });

  it('approves only after Face ID or Touch ID succeeds', async () => {
    enrolled(true);
    const onRespond = jest.fn().mockResolvedValue({ alreadyAnswered: false });
    const user = userEvent.setup();
    await render(<ApprovalCard approval={approval} onRespond={onRespond} />);

    await user.press(screen.getByRole('button', { name: 'Approve' }));

    expect(biometrics.authenticateAsync).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith('approved');
  });

  it('does nothing when the biometric check is cancelled', async () => {
    enrolled(false);
    const onRespond = jest.fn();
    const user = userEvent.setup();
    await render(<ApprovalCard approval={approval} onRespond={onRespond} />);

    await user.press(screen.getByRole('button', { name: 'Approve' }));

    expect(onRespond).not.toHaveBeenCalled();
  });

  it('rejects without a biometric check', async () => {
    const onRespond = jest.fn().mockResolvedValue({ alreadyAnswered: false });
    const user = userEvent.setup();
    await render(<ApprovalCard approval={approval} onRespond={onRespond} />);

    await user.press(screen.getByRole('button', { name: 'Reject' }));

    expect(biometrics.authenticateAsync).not.toHaveBeenCalled();
    expect(onRespond).toHaveBeenCalledWith('rejected');
  });

  it('locks both buttons while an answer is on its way', async () => {
    let finish: (value: { alreadyAnswered: boolean }) => void = () => undefined;
    const onRespond = jest.fn(
      () => new Promise<{ alreadyAnswered: boolean }>((resolve) => (finish = resolve)),
    );
    const user = userEvent.setup();
    await render(<ApprovalCard approval={approval} onRespond={onRespond} />);

    await user.press(screen.getByRole('button', { name: 'Reject' }));

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();

    finish({ alreadyAnswered: false });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
  });

  it('keeps the card with a notice when the answer fails or came too late', async () => {
    const onRespond = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ alreadyAnswered: true });
    const user = userEvent.setup();
    await render(<ApprovalCard approval={approval} onRespond={onRespond} />);

    await user.press(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('That did not go through. Try again.')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Already answered on another device.')).toBeOnTheScreen();
  });
});
