import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AuthServerConfigProvider } from '@/features/AuthShell';
import type { GlobalServerConfig } from '@/types/serverConfig';

import SignIn from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./useSignIn', () => ({
  useSignIn: () => ({ form: {}, step: 'email' }),
}));
vi.mock('./SignInEmailStep', () => ({ SignInEmailStep: () => <div>email step</div> }));
vi.mock('./SignInPhoneStep', () => ({ SignInPhoneStep: () => <div>phone step</div> }));
vi.mock('@lobehub/ui/base-ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

const renderInAuthApp = (serverConfig: Partial<GlobalServerConfig>) =>
  render(
    <AuthServerConfigProvider
      serverConfig={{ aiProvider: {}, telemetry: {}, ...serverConfig } as GlobalServerConfig}
    >
      <SignIn />
    </AuthServerConfigProvider>,
  );

// The sign-in page runs in the auth app, which has its own copy of the server settings and none of
// the main app's stores; reading from the main app's store crashed the page.
describe('SignIn in the auth app', () => {
  it('offers phone sign-in when the server enables it', () => {
    renderInAuthApp({ enablePhoneSignIn: true });

    expect(screen.getByText('email step')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'betterAuth.signin.phone.link' }),
    ).toBeInTheDocument();
  });

  it('shows only the email step otherwise', () => {
    renderInAuthApp({});

    expect(screen.getByText('email step')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'betterAuth.signin.phone.link' })).toBeNull();
  });
});
