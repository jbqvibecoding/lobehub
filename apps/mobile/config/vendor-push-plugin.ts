import {
  type ConfigPlugin,
  withAndroidManifest,
  withProjectBuildGradle,
} from 'expo/config-plugins';

/** The phone makers' client keys, from each maker's developer console. */
export interface VendorPushKeys {
  honorAppId?: string;
  huaweiAppId?: string;
  oppoAppKey?: string;
  oppoAppSecret?: string;
  vivoApiKey?: string;
  vivoAppId?: string;
  xiaomiAppId?: string;
  xiaomiAppKey?: string;
}

export const vendorPushKeysFromEnv = (env: NodeJS.ProcessEnv): VendorPushKeys => ({
  honorAppId: env.HONOR_PUSH_APP_ID,
  huaweiAppId: env.HUAWEI_PUSH_APP_ID,
  oppoAppKey: env.OPPO_PUSH_APP_KEY,
  oppoAppSecret: env.OPPO_PUSH_APP_SECRET,
  vivoApiKey: env.VIVO_PUSH_API_KEY,
  vivoAppId: env.VIVO_PUSH_APP_ID,
  xiaomiAppId: env.XIAOMI_PUSH_APP_ID,
  xiaomiAppKey: env.XIAOMI_PUSH_APP_KEY,
});

/**
 * The manifest entries each maker's SDK (or our module) reads. Ours carry a `biber:` prefix so
 * Android keeps long numeric ids as text; Huawei's carries its own `appid=` prefix for the same
 * reason. Honor and vivo read their entries themselves, under their own names.
 */
export const vendorPushMetaData = (keys: VendorPushKeys): Record<string, string> => {
  const entries: Record<string, string | undefined> = {
    'ai.biber.push.oppo.app_key': keys.oppoAppKey && `biber:${keys.oppoAppKey}`,
    'ai.biber.push.oppo.app_secret': keys.oppoAppSecret && `biber:${keys.oppoAppSecret}`,
    'ai.biber.push.xiaomi.app_id': keys.xiaomiAppId && `biber:${keys.xiaomiAppId}`,
    'ai.biber.push.xiaomi.app_key': keys.xiaomiAppKey && `biber:${keys.xiaomiAppKey}`,
    'com.hihonor.push.app_id': keys.honorAppId,
    'com.huawei.hms.client.appid': keys.huaweiAppId && `appid=${keys.huaweiAppId}`,
    'com.vivo.push.api_key': keys.vivoApiKey,
    'com.vivo.push.app_id': keys.vivoAppId,
  };
  return Object.fromEntries(
    Object.entries(entries).filter((entry): entry is [string, string] => !!entry[1]),
  );
};

const MAKER_REPOSITORIES = [
  "maven { url 'https://developer.huawei.com/repo/' }",
  "maven { url 'https://developer.hihonor.com/repo' }",
];

/** Lets every module resolve the Huawei and Honor push SDKs. */
export const addMakerRepositories = (buildGradle: string): string => {
  if (buildGradle.includes('developer.huawei.com/repo')) return buildGradle;
  return buildGradle.replace(
    /allprojects\s*\{\s*repositories\s*\{/,
    (match) => `${match}\n    ${MAKER_REPOSITORIES.join('\n    ')}`,
  );
};

/**
 * Prepares a mainland China Android build for the phone makers' push services: their client keys
 * in the manifest, the Xiaomi receiver when Xiaomi is configured, and the Maven repositories of
 * Huawei and Honor. The modules/vendor-push module does the registering.
 */
export const withVendorPush: ConfigPlugin<VendorPushKeys> = (config, keys) => {
  config = withProjectBuildGradle(config, (gradle) => {
    gradle.modResults.contents = addMakerRepositories(gradle.modResults.contents);
    return gradle;
  });

  return withAndroidManifest(config, (manifest) => {
    const application = manifest.modResults.manifest.application?.[0];
    if (!application) return manifest;

    const metaData = (application['meta-data'] ??= []);
    for (const [name, value] of Object.entries(vendorPushMetaData(keys))) {
      const existing = metaData.find((entry) => entry.$['android:name'] === name);
      if (existing) existing.$['android:value'] = value;
      else metaData.push({ $: { 'android:name': name, 'android:value': value } });
    }

    if (keys.xiaomiAppId && keys.xiaomiAppKey) {
      const receivers = (application.receiver ??= []);
      const name = 'ai.biber.vendorpush.XiaomiReceiver';
      if (!receivers.some((receiver) => receiver.$['android:name'] === name)) {
        receivers.push({
          '$': { 'android:exported': 'true', 'android:name': name },
          'intent-filter': [
            'com.xiaomi.mipush.RECEIVE_MESSAGE',
            'com.xiaomi.mipush.MESSAGE_ARRIVED',
            'com.xiaomi.mipush.ERROR',
          ].map((action) => ({ action: [{ $: { 'android:name': action } }] })),
        } as never);
      }
    }
    return manifest;
  });
};
