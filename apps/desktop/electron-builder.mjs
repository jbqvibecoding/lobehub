import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { requireAppRegion, resolveAppRegion } from '../../packages/region/src/region.ts';
import {
  copyExternalRuntimeModulesToSource,
  getExternalRuntimeModulesFilesConfig,
} from './external-runtime-deps.config.mjs';
import {
  copyNativeModulesToSource,
  getAsarUnpackPatterns,
  getNativeModulesFilesConfig,
} from './native-deps.config.mjs';
import { verifyFontListSignature } from './scripts/verifyFontListSigning.mjs';
import {
  DESKTOP_PRODUCT_NAME,
  desktopAppId,
  desktopProtocolScheme,
} from './src/common/identity.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const packageJSON = JSON.parse(await fs.readFile(path.join(__dirname, 'package.json'), 'utf8'));

const channel = process.env.UPDATE_CHANNEL;

// Release builds (any update channel) must say which edition they are; local packaging defaults to
// Global. The mainland edition gets its own app id so both can be installed side by side.
const region = channel
  ? requireAppRegion(process.env.APP_REGION, `the ${channel} desktop release`)
  : resolveAppRegion(process.env.APP_REGION);
const arch = os.arch();
const hasAppleCertificate = Boolean(process.env.CSC_LINK);

// Where the app looks for its updates. A release build must name it: without one, electron-builder
// would point the app at the upstream project's GitHub releases, a different product.
const updateServerUrl = process.env.UPDATE_SERVER_URL;
if (channel && !updateServerUrl?.trim()) {
  throw new Error(
    `UPDATE_SERVER_URL is required for the ${channel} desktop release: it is where the app looks for updates`,
  );
}

console.info(`🚄 Build Version ${packageJSON.version}, Channel: ${channel}, Region: ${region}`);
console.info(`🏗️ Building for architecture: ${arch}`);

// Channel identity derived solely from UPDATE_CHANNEL env var.
// Supported channels: stable, nightly, canary
const isStable = !channel || channel === 'stable';
const isNightly = channel === 'nightly';
const isCanary = channel === 'canary';

// Strip trailing channel path from URL for re-appending the correct channel
// Handles both base URL (https://cdn.example.com) and legacy URL with channel (https://cdn.example.com/stable)
const stripChannelSuffix = (url) => url.replace(/\/(stable|nightly|canary|beta)\/?$/, '');

// 根据 channel 配置 publish provider
// - 所有渠道 + UPDATE_SERVER_URL: 使用 generic (S3)
// - 无 UPDATE_SERVER_URL（只有本地打包）: 不发布更新源，打出的应用不自动更新
const getPublishConfig = () => {
  const channelPath = isStable ? 'stable' : isNightly ? 'nightly' : channel || 'stable';

  if (updateServerUrl) {
    const baseUrl = stripChannelSuffix(updateServerUrl);
    const fullUrl = `${baseUrl}/${channelPath}`;
    console.info(`📦 ${channelPath} channel: Using generic provider (${fullUrl})`);
    return [
      {
        provider: 'generic',
        url: fullUrl,
      },
    ];
  }

  console.info(`📦 ${channelPath} channel: No UPDATE_SERVER_URL, so this package does not update`);
  return null;
};

// https://www.electron.build/code-signing-mac#how-to-disable-code-signing-during-the-build-process-on-macos
if (!hasAppleCertificate) {
  // Disable auto discovery to keep electron-builder from searching unavailable signing identities
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  console.info('⚠️ Apple certificate link not found, macOS artifacts will be unsigned.');
}

// The scheme the app listens on (src/common/identity.ts), per edition and pre-release channel
const protocolScheme = desktopProtocolScheme(
  region,
  isCanary ? 'canary' : isNightly ? 'nightly' : undefined,
);

// Determine icon file based on version type
const getIconFileName = () => {
  if (isStable || isCanary) return 'Icon';
  // nightly uses pre-release icon
  return 'Icon-nightly';
};

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration
 */
const config = {
  /**
   * BeforePack hook to resolve pnpm symlinks for native modules.
   * This ensures native modules are properly included in the asar archive.
   */
  beforePack: async () => {
    await copyNativeModulesToSource();
    await copyExternalRuntimeModulesToSource();

    // agent-browser is no longer bundled in the installer — BinaryManager
    // lazily downloads it on first use into the per-user cache dir. See
    // apps/desktop/src/main/modules/binaries/agentBrowserBinaries.ts.

    // Build and copy CLI bundle for embedding
    console.info('📦 Building CLI for embedding...');
    execSync('npm run build:cli', { stdio: 'inherit', cwd: __dirname });
    const cliSrc = path.resolve(__dirname, '../cli/dist/index.js');
    const cliDest = path.resolve(__dirname, 'resources/bin/lobe-cli.js');
    await fs.mkdir(path.dirname(cliDest), { recursive: true });
    await fs.copyFile(cliSrc, cliDest);

    // Write a minimal package.json next to the CLI bundle so that
    // createRequire('../package.json') resolves correctly in the packaged app.
    // The CLI script lives at Resources/bin/lobe-cli.js, so '../package.json'
    // resolves to Resources/package.json.
    const cliPkg = JSON.parse(
      await fs.readFile(path.resolve(__dirname, '../cli/package.json'), 'utf8'),
    );
    await fs.writeFile(
      path.resolve(__dirname, 'resources/cli-package.json'),
      JSON.stringify({ name: cliPkg.name, type: 'module', version: cliPkg.version }),
    );
    console.info('✅ CLI bundle copied to resources/bin/lobe-cli.js');
  },
  /**
   * AfterPack hook for copying Liquid Glass Assets.car on macOS 26+.
   *
   * @see https://github.com/electron-userland/electron-builder/issues/9254
   * @see https://github.com/MultiboxLabs/flow-browser/pull/159
   */
  afterPack: async (context) => {
    const isMac = ['darwin', 'mas'].includes(context.electronPlatformName);

    if (!isMac) {
      return;
    }

    const resourcesPath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
    );
    const iconFileName = getIconFileName();
    const assetsCarSource = path.join(__dirname, 'build', `${iconFileName}.Assets.car`);
    const assetsCarDest = path.join(resourcesPath, 'Assets.car');

    try {
      await fs.access(assetsCarSource);
      await fs.copyFile(assetsCarSource, assetsCarDest);
      console.info(`✅ Copied Liquid Glass icon: ${iconFileName}.Assets.car`);
    } catch {
      // Non-critical: Assets.car not found or copy failed
      // App will use fallback .icns icon on all macOS versions
      console.info(`⏭️  Skipping Assets.car (not found or copy failed)`);
    }
  },
  afterSign: verifyFontListSignature,
  appId: desktopAppId(region),
  appImage: {
    artifactName: '${productName}-${version}.${ext}',
  },

  // Only explicitly selected native binaries should live outside app.asar.
  asar: {
    smartUnpack: false,
  },

  // Native modules must be unpacked from asar to work correctly
  asarUnpack: getAsarUnpackPatterns(),

  detectUpdateChannel: true,

  directories: {
    buildResources: 'build',
    output: 'release',
  },

  dmg: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
    background: 'resources/dmg.png',
    contents: [
      { type: 'file', x: 150, y: 240 },
      { type: 'link', path: '/Applications', x: 450, y: 240 },
    ],
    iconSize: 80,
    window: {
      height: 400,
      width: 600,
    },
  },

  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/',
  },
  // Electron uses underscores for macOS .lproj directories and hyphens for
  // Windows/Linux locale packs. Keep the English variants on every platform.
  electronLanguages: ['en', 'en_GB', 'en_US', 'en-GB', 'en-US'],

  files: [
    'dist',
    'resources',
    'dist/renderer/**/*',
    '!resources/locales',
    '!resources/dmg.png',
    // Exclude all node_modules first
    '!node_modules',
    // Then explicitly include native modules using object form (handles pnpm symlinks)
    ...getNativeModulesFilesConfig(),
    // Include non-native runtime modules that are intentionally externalized from Vite.
    ...getExternalRuntimeModulesFilesConfig(),
  ],
  generateUpdatesFilesForAllChannels: true,
  linux: {
    category: 'Utility',
    icon: 'build/icon.png',
    maintainer: 'electronjs.org',
    target: ['AppImage', 'snap', 'deb', 'rpm', 'tar.gz'],
  },
  mac: {
    binaries: ['Contents/Resources/app.asar.unpacked/node_modules/font-list/libs/darwin/fontlist'],
    compression: 'maximum',
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: {
      CFBundleIconName: 'AppIcon',
      CFBundleURLTypes: [
        {
          CFBundleURLName: `${DESKTOP_PRODUCT_NAME} Protocol`,
          CFBundleURLSchemes: [protocolScheme],
        },
      ],
      NSAppleEventsUsageDescription:
        'Application needs to control System Settings to help you grant Full Disk Access automatically.',
      NSCameraUsageDescription: "Application requests access to the device's camera.",
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder.",
      NSMicrophoneUsageDescription: "Application requests access to the device's microphone.",
      NSScreenCaptureUsageDescription:
        'Application requests access to record and analyze screen content for AI assistance.',
    },
    gatekeeperAssess: false,
    hardenedRuntime: hasAppleCertificate,
    notarize: hasAppleCertificate,
    ...(hasAppleCertificate ? {} : { identity: null }),
    target: [
      { arch: [arch === 'arm64' ? 'arm64' : 'x64'], target: 'dmg' },
      { arch: [arch === 'arm64' ? 'arm64' : 'x64'], target: 'zip' },
    ],
  },
  npmRebuild: true,
  nsis: {
    allowToChangeInstallationDirectory: true,
    artifactName: '${productName}-${version}-setup.${ext}',
    createDesktopShortcut: 'always',
    installerHeader: './build/nsis-header.bmp',
    installerSidebar: './build/nsis-sidebar.bmp',
    oneClick: false,
    shortcutName: '${productName}',
    uninstallDisplayName: '${productName}',
    uninstallerSidebar: './build/nsis-sidebar.bmp',
  },
  protocols: [
    {
      name: `${DESKTOP_PRODUCT_NAME} Protocol`,
      schemes: [protocolScheme],
    },
  ],
  publish: getPublishConfig(),

  // Release notes 配置
  // 可以通过环境变量 RELEASE_NOTES 传入，或从文件读取
  // 这会被写入 latest-mac.yml / latest.yml 中，供 generic provider 使用
  releaseInfo: {
    releaseNotes: process.env.RELEASE_NOTES || undefined,
  },

  extraResources: [
    { from: 'resources/bin', to: 'bin' },
    { from: 'resources/cli-package.json', to: 'package.json' },
  ],

  win: {
    executableName: DESKTOP_PRODUCT_NAME,
  },
};

export default config;
