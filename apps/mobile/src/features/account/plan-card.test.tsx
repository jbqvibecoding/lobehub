import { render, screen } from '@testing-library/react-native';

import { PlanCard } from './plan-card';
import type { PlanStatus } from './types';

const premium: PlanStatus = {
  credits: {
    monthly: 15_000_000,
    periodEnd: new Date(2026, 11, 3),
    remaining: 1_500_000,
    used: 13_500_000,
  },
  plan: 'premium',
  subscription: {
    billingInterval: 'yearly',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date(2027, 10, 3),
    plan: 'premium',
    provider: 'apple',
    status: 'active',
  },
};

describe('PlanCard', () => {
  it('shows the plan, who bills it, and how much of the month is used', async () => {
    await render(<PlanCard status={premium} />);

    expect(screen.getByRole('header', { name: 'Premium' })).toBeOnTheScreen();
    expect(screen.getByText('Billed through the App Store')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 90 });
  });

  it('shows no renewal or billing for the free plan', async () => {
    await render(<PlanCard status={{ ...premium, plan: 'free', subscription: undefined }} />);

    expect(screen.getByRole('header', { name: 'Free' })).toBeOnTheScreen();
    expect(screen.queryByText(/Renews on/)).not.toBeOnTheScreen();
    expect(screen.queryByText(/Billed/)).not.toBeOnTheScreen();
  });
});
