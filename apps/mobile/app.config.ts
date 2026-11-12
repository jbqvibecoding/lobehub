import type { ConfigContext, ExpoConfig } from 'expo/config';

import { appIdentity } from './config/identity.ts';
import { vendorPushKeysFromEnv, withVendorPush } from './config/vendor-push-plugin.ts';

// EAS sets EAS_BUILD on its builders; APP_RELEASE=1 marks a local release build.
const release = process.env.EAS_BUILD === 'true' || process.env.APP_RELEASE === '1';

const identity = appIdentity({
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  region: process.env.APP_REGION,
  release,
});

export default ({ config }: ConfigContext): ExpoConfig => {
  const expoConfig = biberConfig(config);
  // Android phones in mainland China get notifications through their maker's push service
  return identity.region === 'cn'
    ? withVendorPush(expoConfig, vendorPushKeysFromEnv(process.env))
    : expoConfig;
};

const biberConfig = (config: ConfigContext['config']): ExpoConfig => ({
  ...config,
  android: {
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      backgroundImage: './assets/android-icon-background.png',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    package: identity.bundleId,
    predictiveBackGestureEnabled: false,
  },
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: identity.apiUrl,
    region: identity.region,
    scheme: identity.scheme,
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: identity.bundleId,
    supportsTablet: true,
  },
  name: identity.displayName,
  orientation: 'portrait',
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    'expo-web-browser',
    'expo-notifications',
    [
      'expo-local-authentication',
      { faceIDPermission: 'Biber asks for Face ID before it approves an action for you.' },
    ],
    // App Store subscriptions (StoreKit 2)
    'expo-iap',
  ],
  scheme: identity.scheme,
  slug: 'biber',
  userInterfaceStyle: 'automatic',
  version: '0.1.0',
});
