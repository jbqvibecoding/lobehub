import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { getLocales } from 'expo-localization';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { ApiClient } from '@/lib/api-client';

import { isVendorPushAvailable, registerVendorPush } from '../../../modules/vendor-push';

const DEVICE_ID_KEY = 'biber_device_id';
const PUSH_TOKEN_KEY = 'biber_push_token';

/** The server sends on this Android channel (`DEFAULT_PUSH_CHANNEL_ID`); others are dropped. */
const ANDROID_CHANNEL_ID = 'default';

const installationId = async () => {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;

  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, created);
  return created;
};

export type PushRegistration = 'denied' | 'registered' | 'unavailable';

/** How long to wait for a phone maker's push service to issue a token. */
const VENDOR_TOKEN_TIMEOUT_MS = 20_000;

/**
 * On Android phones in mainland China, the token of the phone maker's own push service (Huawei,
 * Honor, Xiaomi, OPPO, vivo): those phones have no Google services, which Expo's Android
 * notifications travel through. Null elsewhere, or when the maker does not answer.
 */
const vendorPushToken = async () => {
  if (Platform.OS !== 'android' || Constants.expoConfig?.extra?.region !== 'cn') return null;
  if (!isVendorPushAvailable()) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), VENDOR_TOKEN_TIMEOUT_MS);
  });
  try {
    return await Promise.race([registerVendorPush(), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Lets the server reach this phone when something needs the user. Simulators, and builds with
 * neither a phone maker's push service nor an EAS project id, cannot get a push token, so they
 * report `unavailable` instead of failing.
 */
export const registerForPush = async (api: ApiClient): Promise<PushRegistration> => {
  if (!Device.isDevice || (Platform.OS !== 'ios' && Platform.OS !== 'android')) {
    return 'unavailable';
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const mayUseVendor = isVendorPushAvailable() && Constants.expoConfig?.extra?.region === 'cn';
  if (!projectId && !mayUseVendor) return 'unavailable';

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      importance: Notifications.AndroidImportance.HIGH,
      name: 'Biber',
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return 'denied';

  const vendor = await vendorPushToken();
  if (!vendor && !projectId) return 'unavailable';
  const { provider, token } = vendor ?? {
    provider: 'expo' as const,
    token: (await Notifications.getExpoPushTokenAsync({ projectId })).data,
  };

  await api.mutation('pushToken.register', {
    appVersion: Constants.expoConfig?.version,
    deviceId: await installationId(),
    // The field is named for Expo but carries whichever provider's token this is
    expoToken: token,
    locale: getLocales()[0]?.languageTag,
    platform: Platform.OS,
    provider,
  });
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);

  return 'registered';
};

/**
 * Called before signing out, so a signed-out phone stops receiving the account's notifications.
 * The server accepts it without a session, proving ownership with the device id and token pair.
 */
export const unregisterPush = async (api: ApiClient) => {
  const expoToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  if (!expoToken) return;

  await api.mutation('pushToken.unregister', { deviceId: await installationId(), expoToken });
  await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
};
