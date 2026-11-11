import { render, screen, userEvent } from '@testing-library/react-native';

import { type PhoneAuth, PhoneSignIn } from './phone-sign-in';

const setup = async (auth: Partial<PhoneAuth> = {}) => {
  const phone: PhoneAuth = {
    sendOtp: jest.fn().mockResolvedValue({ error: null }),
    verify: jest.fn().mockResolvedValue({ error: null }),
    ...auth,
  };
  const user = userEvent.setup();
  await render(<PhoneSignIn auth={phone} />);
  return { phone, user };
};

describe('PhoneSignIn', () => {
  it('texts a code to the number, then signs in with it', async () => {
    const { phone, user } = await setup();

    await user.type(screen.getByLabelText('Mobile number'), '138 0013 8000');
    await user.press(screen.getByRole('button', { name: 'Send code' }));
    expect(phone.sendOtp).toHaveBeenCalledWith({ phoneNumber: '+8613800138000' });

    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(phone.verify).toHaveBeenCalledWith({ code: '123456', phoneNumber: '+8613800138000' });
  });

  it('does not text a number that is not a mainland mobile', async () => {
    const { phone, user } = await setup();

    await user.type(screen.getByLabelText('Mobile number'), '+1 415 555 0100');
    await user.press(screen.getByRole('button', { name: 'Send code' }));

    expect(phone.sendOtp).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter an 11-digit mainland China mobile number.',
    );
  });

  it('says so when the code is wrong', async () => {
    const { user } = await setup({
      verify: jest.fn().mockResolvedValue({ error: { code: 'INVALID_OTP' } }),
    });

    await user.type(screen.getByLabelText('Mobile number'), '13800138000');
    await user.press(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '000000');
    await user.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is wrong or has expired.',
    );
  });
});
