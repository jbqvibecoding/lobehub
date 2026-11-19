import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { initServerConfigStore, Provider } from '@/store/serverConfig/store';

import { useSiteIconUrl } from './useSiteIconUrl';

const iconIn = (region: 'cn' | 'global' | undefined, host?: string) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider
      createStore={() =>
        initServerConfigStore({ serverConfig: { aiProvider: {}, region, telemetry: {} } })
      }
    >
      {children}
    </Provider>
  );

  return renderHook(() => useSiteIconUrl(), { wrapper }).result.current(host);
};

describe('useSiteIconUrl', () => {
  it('asks DuckDuckGo for the icon in the Global edition', () => {
    expect(iconIn('global', 'example.com')).toBe(
      'https://icons.duckduckgo.com/ip3/example.com.ico',
    );
  });

  it.each([
    ['the mainland edition', 'cn'],
    ['an edition not yet known', undefined],
  ] as const)('gives no icon in %s', (_, region) => {
    expect(iconIn(region, 'example.com')).toBeUndefined();
  });

  it('gives no icon without a host', () => {
    expect(iconIn('global', '')).toBeUndefined();
  });
});
