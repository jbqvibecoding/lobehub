import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { isVendorPushAvailable, registerVendorPush } from '../../../modules/vendor-push';
import { registerForPush } from './register-for-push';

jest.mock('../../../modules/vendor-push', () => ({
  isVendorPushAvailable: jest.fn(),
  registerVendorPush: jest.fn(),
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'device-1' }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'zh-CN' }] }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => 'device-1'),
  setItemAsync: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abc]' })),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));

const api = { mutation: jest.fn(), query: jest.fn() };

const build = (extra: Record<string, unknown>) => {
  (Constants as any).expoConfig = { extra, version: '0.1.0' };
};

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
});

describe('registerForPush', () => {
  it("registers the phone maker's token on a mainland Android phone", async () => {
    build({ eas: { projectId: 'p1' }, region: 'cn' });
    jest.mocked(isVendorPushAvailable).mockReturnValue(true);
    jest.mocked(registerVendorPush).mockResolvedValue({ provider: 'huawei', token: 'hw-token' });

    expect(await registerForPush(api as any)).toBe('registered');
    expect(api.mutation).toHaveBeenCalledWith(
      'pushToken.register',
      expect.objectContaining({ expoToken: 'hw-token', platform: 'android', provider: 'huawei' }),
    );
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('falls back to Expo when the maker has no push service on the phone', async () => {
    build({ eas: { projectId: 'p1' }, region: 'cn' });
    jest.mocked(isVendorPushAvailable).mockReturnValue(true);
    jest.mocked(registerVendorPush).mockResolvedValue(null);

    await registerForPush(api as any);

    expect(api.mutation).toHaveBeenCalledWith(
      'pushToken.register',
      expect.objectContaining({ expoToken: 'ExponentPushToken[abc]', provider: 'expo' }),
    );
  });

  it('works without an EAS project when the maker issues a token', async () => {
    build({ region: 'cn' });
    jest.mocked(isVendorPushAvailable).mockReturnValue(true);
    jest.mocked(registerVendorPush).mockResolvedValue({ provider: 'xiaomi', token: 'mi-token' });

    expect(await registerForPush(api as any)).toBe('registered');
  });

  it('uses Expo in the Global edition without asking the maker', async () => {
    build({ eas: { projectId: 'p1' }, region: 'global' });
    jest.mocked(isVendorPushAvailable).mockReturnValue(true);

    await registerForPush(api as any);

    expect(registerVendorPush).not.toHaveBeenCalled();
    expect(api.mutation).toHaveBeenCalledWith(
      'pushToken.register',
      expect.objectContaining({ provider: 'expo' }),
    );
  });

  it('reports unavailable when neither a maker nor Expo can issue a token', async () => {
    build({ region: 'cn' });
    jest.mocked(isVendorPushAvailable).mockReturnValue(true);
    jest.mocked(registerVendorPush).mockResolvedValue(null);

    expect(await registerForPush(api as any)).toBe('unavailable');
    expect(api.mutation).not.toHaveBeenCalled();
  });
});
