import { describe, expect, it } from 'vitest';

import { isMainlandRegion, regionalIdentifier, requireAppRegion, resolveAppRegion } from './region';

describe('resolveAppRegion', () => {
  it('falls back to global when no region is configured', () => {
    expect(resolveAppRegion(undefined)).toBe('global');
    expect(resolveAppRegion(null)).toBe('global');
    expect(resolveAppRegion('  ')).toBe('global');
  });

  it('accepts configured regions regardless of case and surrounding spaces', () => {
    expect(resolveAppRegion(' CN ')).toBe('cn');
    expect(resolveAppRegion('Dev')).toBe('dev');
  });

  it('refuses unknown regions instead of guessing', () => {
    expect(() => resolveAppRegion('china')).toThrow('Invalid APP_REGION "china"');
  });
});

describe('requireAppRegion', () => {
  it('fails when the region is missing, naming what needed it', () => {
    expect(() => requireAppRegion('', 'the stable desktop release')).toThrow(
      'APP_REGION is required for the stable desktop release',
    );
  });

  it('returns an explicit region', () => {
    expect(requireAppRegion('global', 'a release')).toBe('global');
  });
});

describe('region identity', () => {
  it('treats dev like the mainland edition', () => {
    expect(isMainlandRegion('global')).toBe(false);
    expect(isMainlandRegion('cn')).toBe(true);
    expect(isMainlandRegion('dev')).toBe(true);
  });

  it('keeps unsuffixed identifiers for global and qualifies the others', () => {
    expect(regionalIdentifier('com.example.app', 'global')).toBe('com.example.app');
    expect(regionalIdentifier('com.example.app', 'cn')).toBe('com.example.app.cn');
    expect(regionalIdentifier('example', 'dev', '-')).toBe('example-dev');
  });
});
