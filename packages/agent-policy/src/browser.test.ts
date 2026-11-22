import { describe, expect, it } from 'vitest';

import { isActivatingKey, isConsequentialControl } from './browser';

const button = (name: string) => ({ name, role: 'button' });

describe('isConsequentialControl', () => {
  it.each([
    'Pay now',
    'Buy now',
    'Purchase',
    'Checkout',
    'Check out',
    'Proceed to checkout',
    'Place order',
    'Place your order',
    'Submit order',
    'Complete purchase',
    'Confirm payment',
    'Confirm and pay',
    'Order now',
    'Send',
    'Send message',
    'Delete',
    'Delete account',
    'Remove',
    'Transfer $50',
    'Subscribe',
    'Donate',
    '🛒 Buy',
    '+ Delete',
    '立即支付',
    '确认付款',
    '去结算',
    '提交订单',
    '立即购买',
    '立即下单',
    '删除',
    '发送',
    '转账',
    '订阅',
  ])('asks before acting on “%s”', (name) => {
    expect(isConsequentialControl(button(name))).toBe(true);
  });

  it.each([
    'Order history',
    'Sender',
    'Delivery',
    'Payment methods',
    'Add to cart',
    'Next page',
    'Sign in',
    'Search',
    'Paypal',
    'Removal policy',
    '删除线',
    '支付方式',
    '支付宝',
    '订单记录',
    '下一页',
    '登录',
    '',
  ])('lets “%s” through', (name) => {
    expect(isConsequentialControl(button(name))).toBe(false);
  });

  it('counts links and menu items, and nothing that is not a control', () => {
    expect(isConsequentialControl({ name: 'Delete', role: 'link' })).toBe(true);
    expect(isConsequentialControl({ name: 'Delete', role: 'menuitem' })).toBe(true);
    expect(isConsequentialControl({ name: 'Pay now', role: 'heading' })).toBe(false);
    expect(isConsequentialControl({ name: 'Pay now', role: 'textbox' })).toBe(false);
    expect(isConsequentialControl({ name: 'Pay now' })).toBe(false);
  });
});

describe('isActivatingKey', () => {
  it('knows the keys that press or submit', () => {
    for (const key of ['Enter', 'NumpadEnter', ' ', 'Space'])
      expect(isActivatingKey(key)).toBe(true);
    for (const key of ['Tab', 'a', 'ArrowDown', 'Escape']) expect(isActivatingKey(key)).toBe(false);
  });
});
