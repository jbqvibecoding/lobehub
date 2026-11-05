/**
 * @jest-environment node
 */
import { appIdentity } from './identity';

describe('appIdentity', () => {
  it('gives Global the unsuffixed identity and a local server in development', () => {
    expect(appIdentity({ release: false })).toEqual({
      apiUrl: 'http://localhost:3010',
      bundleId: 'ai.biber.app',
      displayName: 'Biber',
      region: 'global',
      scheme: 'biber',
    });
  });

  it('qualifies the mainland and internal builds so all three install side by side', () => {
    expect(appIdentity({ region: 'cn', release: false })).toMatchObject({
      bundleId: 'ai.biber.app.cn',
      displayName: 'Biber',
      scheme: 'biber-cn',
    });
    expect(appIdentity({ region: 'dev', release: false })).toMatchObject({
      bundleId: 'ai.biber.app.dev',
      displayName: 'Biber Dev',
      scheme: 'biber-dev',
    });
  });

  it('refuses a release build that does not name its region or server', () => {
    expect(() => appIdentity({ apiUrl: 'https://api.example.test', release: true })).toThrow(
      'APP_REGION is required',
    );
    expect(() => appIdentity({ region: 'global', release: true })).toThrow('https address');
    expect(() =>
      appIdentity({ apiUrl: 'http://api.example.test', region: 'global', release: true }),
    ).toThrow('https address');
  });

  it('accepts a release build with both, without a trailing slash', () => {
    expect(
      appIdentity({ apiUrl: 'https://api.example.test/', region: 'cn', release: true }).apiUrl,
    ).toBe('https://api.example.test');
  });
});
