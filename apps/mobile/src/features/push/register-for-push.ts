import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { getLocales } from 'expo-localization';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { ApiClient } from '@/lib/api-client';

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

/**
 * Lets the server reach this phone when something needs the user. Simulators and builds without
 * an EAS project id cannot get a push token, so they report `unavailable` instead of failing.
 */
export const registerForPush = async (api: ApiClient): Promise<PushRegistration> => {
  if (!Device.isDevice || (Platform.OS !== 'ios' && Platform.OS !== 'android')) {
    return 'unavailable';
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return 'unavailable';

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      importance: Notifications.AndroidImportance.HIGH,
      name: 'Biber',
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return 'denied';

  const { data: expoToken } = await Notifications.getExpoPushTokenAsync({ projectId });

  await api.mutation('pushToken.register', {
    appVersion: Constants.expoConfig?.version,
    deviceId: await installationId(),
    expoToken,
    locale: getLocales()[0]?.languageTag,
    platform: Platform.OS,
  });
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, expoToken);

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
