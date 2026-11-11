import { describe, expect, it } from 'vitest';

import { normalizeMainlandMobile } from './phone';

describe('normalizeMainlandMobile', () => {
  it('accepts a mainland mobile number however it is typed', () => {
    for (const input of ['13800138000', '138 0013 8000', '+86 138-0013-8000', '8613800138000']) {
      expect(normalizeMainlandMobile(input)).toBe('+8613800138000');
    }
  });

  it('refuses landlines, short numbers and numbers abroad', () => {
    for (const input of ['010-12345678', '1380013800', '+1 415 555 0100', '12800138000']) {
      expect(normalizeMainlandMobile(input)).toBeUndefined();
    }
  });
});
