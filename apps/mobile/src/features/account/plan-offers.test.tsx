import { render, screen, userEvent } from '@testing-library/react-native';

import { PlanOffers } from './plan-offers';
import type { AppleProduct } from './store/upgrade-offers';

const products: AppleProduct[] = [
  { interval: 'monthly', monthlyCredits: 15_000_000, plan: 'premium', productId: 'premium.m' },
  { interval: 'yearly', monthlyCredits: 15_000_000, plan: 'premium', productId: 'premium.y' },
];
const prices = new Map([
  ['premium.m', '$19.99'],
  ['premium.y', '$199.99'],
]);

const renderOffers = (props: Partial<Parameters<typeof PlanOffers>[0]> = {}) => {
  const handlers = { onBuy: jest.fn(), onManage: jest.fn(), onRestore: jest.fn() };
  const view = render(
    <PlanOffers
      billedByApple={false}
      currentPlan="starter"
      prices={prices}
      products={products}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, view };
};

describe('PlanOffers', () => {
  it('sells a higher plan at its App Store price, monthly or yearly', async () => {
    const user = userEvent.setup();
    const { onBuy, view } = renderOffers();
    await view;

    expect(screen.getByText('$19.99 / month')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Subscribe Premium' }));
    expect(onBuy).toHaveBeenCalledWith('premium.m');

    await user.press(screen.getByRole('tab', { name: 'Yearly' }));
    expect(screen.getByText('$199.99 / year')).toBeOnTheScreen();
  });

  it('holds further purchases while one is in progress', async () => {
    await renderOffers({ buying: 'premium.m' }).view;

    expect(screen.getByRole('button', { name: 'Subscribe Premium' })).toBeDisabled();
  });

  it('offers restore always, and subscription management to App Store subscribers', async () => {
    await renderOffers().view;
    expect(screen.getByRole('button', { name: 'Restore purchases' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Manage subscription' })).not.toBeOnTheScreen();

    await renderOffers({ billedByApple: true, notice: 'purchaseThanks' }).view;
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeOnTheScreen();
    expect(screen.getByText('Thank you! Your plan is active.')).toBeOnTheScreen();
  });
});
