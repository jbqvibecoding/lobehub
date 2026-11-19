import { autoUpdater } from 'electron-updater';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App as AppCore } from '../../App';
import { UpdaterManager } from '../UpdaterManager';

vi.mock('electron-log', () => ({
  default: { transports: { file: { getFile: () => ({ path: '/mock/log' }), level: 'info' } } },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    channel: 'stable',
    checkForUpdates: vi.fn(),
    on: vi.fn(),
    setFeedURL: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  app: { getVersion: vi.fn().mockReturnValue('0.0.0'), releaseSingleInstanceLock: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

// A package built without UPDATE_SERVER_URL, e.g. one made locally
vi.mock('@/modules/updater/configs', () => ({
  UPDATE_CHANNEL: 'stable',
  UPDATE_SERVER_URL: undefined,
  updaterConfig: {
    app: { autoCheckUpdate: true, autoDownloadUpdate: true, checkUpdateInterval: 3_600_000 },
    enableAppUpdate: true,
  },
}));

vi.mock('@/env', () => ({ getDesktopEnv: () => ({ FORCE_DEV_UPDATE_CONFIG: false }) }));

vi.mock('@/const/env', () => ({ isDev: false }));

describe('UpdaterManager without an update server', () => {
  let broadcast: ReturnType<typeof vi.fn>;
  let updater: UpdaterManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    broadcast = vi.fn();
    updater = new UpdaterManager({
      browserManager: { getMainWindow: () => ({ broadcast }) },
      menuManager: { rebuildAppMenu: vi.fn() },
      storeManager: { get: vi.fn().mockReturnValue('stable'), set: vi.fn() },
    } as unknown as AppCore);
  });

  it('never points the app at another product’s releases', async () => {
    await updater.initialize();
    updater.switchChannel('canary');
    await vi.advanceTimersByTimeAsync(2 * 3_600_000);

    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('answers a manual check by saying this build does not update itself', async () => {
    await updater.initialize();
    await updater.checkForUpdates({ manual: true });

    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith(
      'updaterStateChanged',
      expect.objectContaining({
        errorMessage: expect.stringContaining('no update server'),
        stage: 'error',
      }),
    );
  });
});
