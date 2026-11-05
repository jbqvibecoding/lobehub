import Constants from 'expo-constants';

/** What app.config.ts baked into this build: which edition it is and which server it talks to. */
export interface AppConfig {
  apiUrl: string;
  region: 'cn' | 'dev' | 'global';
  scheme: string;
}

const extra = Constants.expoConfig?.extra as Partial<AppConfig> | undefined;

if (!extra?.apiUrl || !extra.region || !extra.scheme) {
  throw new Error('Biber was built without apiUrl, region and scheme in its app config');
}

export const appConfig: AppConfig = {
  apiUrl: extra.apiUrl,
  region: extra.region,
  scheme: extra.scheme,
};

/** Only the mainland edition is labelled; Global is the unlabelled default. */
export const isMainlandEdition = appConfig.region !== 'global';
