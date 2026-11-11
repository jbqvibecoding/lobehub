import { describe, expect, it } from 'vitest';

import { formatCredits, formatPlanPrice } from './format';

describe('formatPlanPrice', () => {
  it("uses the currency's own minor unit", () => {
    expect(formatPlanPrice(900, 'usd', 'en-US')).toBe('$9.00');
    // Intl separates the symbol with a non-breaking space
    expect(formatPlanPrice(9900, 'eur', 'de-DE').replaceAll(/\s/g, ' ')).toBe('99,00 €');
    expect(formatPlanPrice(1500, 'jpy', 'ja-JP')).toBe('￥1,500');
  });
});

describe('formatCredits', () => {
  it('shows millions compactly and smaller amounts in full', () => {
    expect(formatCredits(5_000_000)).toBe('5M');
    expect(formatCredits(1_250_000)).toBe('1.25M');
    expect(formatCredits(500_000)).toBe('500,000');
  });
});
