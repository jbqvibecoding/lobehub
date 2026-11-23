import { render, screen, userEvent } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import { ApprovalCard } from './approval-card';
import type { PendingApproval } from './types';

jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn(),
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
}));

const question: PendingApproval = {
  apiName: 'askUserQuestion',
  arguments: JSON.stringify({
    questions: [
      {
        header: 'Branch',
        options: [{ description: 'The default branch', label: 'main' }, { label: 'develop' }],
        question: 'Which branch should I start from?',
      },
    ],
  }),
  createdAt: new Date('2026-11-23T10:00:00Z'),
  id: 'tool-q',
  identifier: 'claude-code',
  type: 'default',
};

describe('the coding expert’s question', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends the option the user picked, with no Face ID step', async () => {
    const onRespond = jest.fn().mockResolvedValue({ alreadyAnswered: false });
    const user = userEvent.setup();
    await render(<ApprovalCard approval={question} onRespond={onRespond} />);

    expect(screen.getByText('Which branch should I start from?')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('radio', { name: 'main' }));
    await user.press(screen.getByRole('button', { name: 'Send' }));

    expect(onRespond).toHaveBeenCalledWith('approved', {
      'Which branch should I start from?': 'main',
    });
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
  });

  it('sends an answer in the user’s own words as it was written', async () => {
    const onRespond = jest.fn().mockResolvedValue({ alreadyAnswered: false });
    const user = userEvent.setup();
    await render(<ApprovalCard approval={question} onRespond={onRespond} />);

    await user.type(screen.getByLabelText('Or answer in your own words'), 'Make a new branch');
    await user.press(screen.getByRole('button', { name: 'Send' }));

    expect(onRespond).toHaveBeenCalledWith('approved', { __freeform__: 'Make a new branch' });
  });

  it('asks for an answer before sending, and can be skipped', async () => {
    const onRespond = jest.fn().mockResolvedValue({ alreadyAnswered: false });
    const user = userEvent.setup();
    await render(<ApprovalCard approval={question} onRespond={onRespond} />);

    await user.press(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByText('Pick an option or write an answer.')).toBeOnTheScreen();
    expect(onRespond).not.toHaveBeenCalled();

    await user.press(screen.getByRole('button', { name: 'Skip' }));
    expect(onRespond).toHaveBeenCalledWith('rejected', undefined);
  });

  it('keeps the card with a notice when the answer did not go through', async () => {
    const onRespond = jest.fn().mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    await render(<ApprovalCard approval={question} onRespond={onRespond} />);

    await user.press(screen.getByRole('radio', { name: 'develop' }));
    await user.press(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('That did not go through. Try again.')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'develop' })).toBeChecked();
  });
});
