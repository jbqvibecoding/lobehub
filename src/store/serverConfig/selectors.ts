import { type ServerConfigStore } from './store';

export const featureFlagsSelectors = (s: ServerConfigStore) => s.featureFlags;

export const serverConfigSelectors = {
  disableEmailPassword: (s: ServerConfigStore) => s.serverConfig.disableEmailPassword || false,
  enableBilling: (s: ServerConfigStore) => s.serverConfig.enableBilling || false,
  enableBusinessFeatures: (s: ServerConfigStore) => s.serverConfig.enableBusinessFeatures || false,
  enableEmailVerification: (s: ServerConfigStore) =>
    s.serverConfig.enableEmailVerification || false,
  enableCloudComputer: (s: ServerConfigStore) => s.serverConfig.enableCloudComputer || false,
  enableComposio: (s: ServerConfigStore) => s.serverConfig.enableComposio || false,
  enableGatewayMode: (s: ServerConfigStore) => s.serverConfig.enableGatewayMode || false,
  enableLobehubSkill: (s: ServerConfigStore) => s.serverConfig.enableLobehubSkill || false,
  enableMagicLink: (s: ServerConfigStore) => s.serverConfig.enableMagicLink || false,
  enableMarketTrustedClient: (s: ServerConfigStore) =>
    s.serverConfig.enableMarketTrustedClient || false,
  enableUploadFileToServer: (s: ServerConfigStore) => s.serverConfig.enableUploadFileToServer,
  enableMultimodalUnderstanding: (s: ServerConfigStore) =>
    s.serverConfig.enableMultimodalUnderstanding || false,
  enabledTelemetryChat: (s: ServerConfigStore) => s.serverConfig.telemetry.langfuse || false,
  /**
   * Whether this is the Global edition, the only one that may hand user content to services
   * abroad. False until the server config arrives, so those services stay off rather than flash on.
   */
  isGlobalEdition: (s: ServerConfigStore) => s.serverConfig.region === 'global',
  isMobile: (s: ServerConfigStore) => s.isMobile || false,
  oAuthSSOProviders: (s: ServerConfigStore) => s.serverConfig.oAuthSSOProviders,
  multimodalUnderstanding: (s: ServerConfigStore) => s.serverConfig.multimodalUnderstanding,
};
