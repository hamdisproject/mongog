import type { UpdateStatusPayload, UpdatePhase, UpdateCheckResult } from '../../shared/ipc/index.js';
import { serializeError } from '../../shared/errors/index.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseUpdateConfig } from '../../shared/update-config.mjs';

/**
 * Minimal structural surface of electron-updater's autoUpdater that this service
 * relies on. Kept intentionally small so unit tests can inject a fake without
 * loading electron/electron-updater under plain Node.
 */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  disableDifferentialDownload: boolean;
  disableWebInstaller: boolean;
  setFeedURL(options: { provider: 'generic'; url: string }): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: unknown[]) => void): object;
  removeListener(event: string, listener: (...args: unknown[]) => void): object;
}

export type UpdateBroadcast = (payload: UpdateStatusPayload) => void;

/**
 * Pure application logic around an injectable updater. Main process wires the
 * real electron-updater autoUpdater through {@link createUpdateService}; unit
 * tests inject a fake. All state is mirrored to the renderer via `broadcast`.
 */
export class UpdateService {
  private updater: UpdaterLike | undefined;
  private broadcast: UpdateBroadcast;
  private getCurrentVersion: () => string;
  private phase: UpdatePhase = 'idle';
  private availableVersion: string | null = null;
  private disposed = false;
  private checkPromise: Promise<UpdateCheckResult> | null = null;
  private listeners: Array<{ event: string; listener: (...args: unknown[]) => void }> = [];
  private lastError: string | null = null;
  private automaticDownload: boolean;

  constructor(
    updater: UpdaterLike | undefined,
    broadcast: UpdateBroadcast,
    getCurrentVersion: () => string,
    initializationError?: unknown,
    automaticDownload = false,
  ) {
    this.updater = updater;
    this.broadcast = broadcast;
    this.getCurrentVersion = getCurrentVersion;
    this.automaticDownload = automaticDownload;
    if (!this.updater && initializationError !== undefined) {
      this.phase = 'error';
      this.lastError = errorMessage(initializationError);
    }
    // Windows downloads in the background but still requires an explicit
    // Restart & Install action. macOS and Linux retain consent-driven downloads.
    // No platform ever installs a downloaded update merely because the app quits.
    if (this.updater) {
      this.updater.autoDownload = this.automaticDownload;
      this.updater.autoInstallOnAppQuit = false;
      this.updater.disableDifferentialDownload = true;
      this.updater.disableWebInstaller = true;
      this.attachListeners();
    }
  }

  get isSupported(): boolean {
    return this.updater !== undefined;
  }

  check(): Promise<UpdateCheckResult> {
    if (this.disposed) {
      return Promise.resolve(this.result('not-supported'));
    }
    if (!this.updater) {
      return Promise.resolve(this.result(this.lastError ? 'error' : 'not-supported'));
    }
    if (this.checkPromise) return this.checkPromise;
    if (this.phase === 'downloading' || this.phase === 'downloaded') {
      return Promise.resolve(this.result(this.phase));
    }

    this.checkPromise = this.runCheck().finally(() => {
      this.checkPromise = null;
    });
    return this.checkPromise;
  }

  private async runCheck(): Promise<UpdateCheckResult> {
    this.phase = 'checking';
    this.lastError = null;
    this.broadcast({ phase: 'checking' });
    try {
      await this.updater!.checkForUpdates();
      return this.result(this.phase);
    } catch (err) {
      return this.fail(err);
    }
  }

  async install(): Promise<void> {
    if (this.disposed || !this.updater) return;
    if (this.phase === 'downloaded') {
      this.updater.quitAndInstall();
      return;
    }
    if (this.phase !== 'available') {
      throw new Error('An update must be available before it can be downloaded.');
    }
    this.phase = 'downloading';
    this.lastError = null;
    this.broadcast({ phase: 'downloading', version: this.availableVersion ?? undefined });
    try {
      await this.updater.downloadUpdate();
    } catch (err) {
      this.fail(err);
    }
  }

  dismiss(): void {
    if (this.phase === 'downloading' || this.phase === 'downloaded') return;
    this.phase = 'idle';
    this.availableVersion = null;
    this.lastError = null;
    this.broadcast({ phase: 'idle' });
  }

  dispose(): void {
    this.disposed = true;
    if (this.updater) {
      for (const { event, listener } of this.listeners) this.updater.removeListener(event, listener);
    }
    this.listeners = [];
  }

  private attachListeners(): void {
    this.listen('checking-for-update', () => {
      this.phase = 'checking';
      this.broadcast({ phase: 'checking' });
    });
    this.listen('update-available', (...args) => {
      const info = args[0] as { version?: string } | undefined;
      this.availableVersion = info?.version ?? null;
      this.lastError = null;
      if (this.automaticDownload) {
        // electron-updater starts the transfer after this event when
        // autoDownload is enabled. Publish downloading immediately so the
        // renderer never flashes the manual-download consent prompt.
        this.phase = 'downloading';
        this.broadcast({ phase: 'downloading', version: this.availableVersion ?? undefined });
      } else {
        this.phase = 'available';
        this.broadcast({ phase: 'available', version: this.availableVersion ?? undefined });
      }
    });
    this.listen('update-not-available', () => {
      this.availableVersion = null;
      this.phase = 'up-to-date';
      this.lastError = null;
      this.broadcast({ phase: 'up-to-date' });
    });
    this.listen('download-progress', (...args) => {
      const progress = args[0] as { percent?: number } | undefined;
      this.phase = 'downloading';
      this.broadcast({
        phase: 'downloading',
        version: this.availableVersion ?? undefined,
        progress: typeof progress?.percent === 'number' ? progress.percent : undefined,
      });
    });
    this.listen('update-downloaded', () => {
      this.phase = 'downloaded';
      this.broadcast({ phase: 'downloaded', version: this.availableVersion ?? undefined });
    });
    this.listen('error', (err: unknown) => {
      this.recordFailure(err);
    });
  }

  private listen(event: string, listener: (...args: unknown[]) => void): void {
    this.updater!.on(event, listener);
    this.listeners.push({ event, listener });
  }

  private result(phase: UpdatePhase): UpdateCheckResult {
    return {
      phase,
      currentVersion: safeVersion(this.getCurrentVersion()),
      version: this.availableVersion ?? undefined,
      ...(phase === 'error' && this.lastError ? { error: this.lastError } : {}),
    };
  }

  private fail(err: unknown): UpdateCheckResult & { error?: string } {
    this.recordFailure(err);
    return this.result('error');
  }

  private recordFailure(err: unknown): void {
    const error = errorMessage(err);
    const changed = this.phase !== 'error' || this.lastError !== error;
    this.phase = 'error';
    this.lastError = error;
    if (changed) this.broadcast({ phase: 'error', error });
  }
}

export interface CreateUpdateServiceOptions {
  /** When set, wire a deterministic fake updater that reports this version as
   *  available (used by e2e tests). No network is touched and every phase
   *  transition is immediate. */
  e2eVersion?: string;
  /** Injectable real-updater factory; override in unit tests to avoid loading
   *  electron-updater/electron under plain Node. */
  createRealUpdater?: (feedUrl: string) => Promise<UpdaterLike>;
  getCurrentVersion?: () => string;
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  resourcesPath?: string;
}

/** Main-process factory wiring the real electron-updater autoUpdater. */
export async function createUpdateService(
  broadcast: UpdateBroadcast,
  feedUrl: string,
  options: CreateUpdateServiceOptions = {},
): Promise<UpdateService> {
  const getCurrentVersion = options.getCurrentVersion ?? defaultCurrentVersion;
  const platform = options.platform ?? process.platform;
  const automaticDownload = platform === 'win32';
  try {
    if (options.e2eVersion) {
      return new UpdateService(
        createFakeUpdater(options.e2eVersion),
        broadcast,
        getCurrentVersion,
        undefined,
        automaticDownload,
      );
    }
    if (options.isPackaged === false) {
      return new UpdateService(undefined, broadcast, getCurrentVersion);
    }
    if (platform === 'linux' && !isRpmPackage(options.resourcesPath ?? process.resourcesPath)) {
      return new UpdateService(undefined, broadcast, getCurrentVersion);
    }
    if (platform === 'darwin' || platform === 'linux' || platform === 'win32') {
      try {
        parseUpdateConfig(readFileSync(path.join(options.resourcesPath ?? process.resourcesPath, 'app-update.yml'), 'utf8'));
      } catch {
        throw new Error(
          'Update configuration is missing or invalid in this installation. Download and reinstall MongoG from https://mongog.com. Your saved connections and workspace will be preserved.',
        );
      }
    }
    const createReal = options.createRealUpdater ?? importRealUpdater;
    const updater = await createReal(feedUrl);
    return new UpdateService(updater, broadcast, getCurrentVersion, undefined, automaticDownload);
  } catch (error) {
    // Keep initialization failures actionable through the existing error phase;
    // they must not take down the app or masquerade as unsupported builds.
    return new UpdateService(
      undefined,
      broadcast,
      getCurrentVersion,
      error,
    );
  }
}

async function importRealUpdater(feedUrl: string): Promise<UpdaterLike> {
  // The main bundle is ESM while electron-updater is CommonJS. Loading it via
  // createRequire avoids Electron's packaged ESM/CJS dynamic-import interop
  // failure while still resolving the dependency from app.asar.
  const require = createRequire(import.meta.url);
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
  const e2eCachePath = process.env.MONGOG_E2E_USER_DATA?.trim()
    ? process.env.MONGOG_UPDATE_E2E_CACHE_PATH?.trim()
    : undefined;
  if (e2eCachePath) {
    const updaterWithApp = autoUpdater as typeof autoUpdater & { app: { baseCachePath: string } };
    Object.defineProperty(updaterWithApp.app, 'baseCachePath', { get: () => e2eCachePath });
  }
  // electron-updater requires an Electron runtime; running outside a packaged
  // app it still accepts configuration but its checks reject at run time. Keep
  // the service constructible so the IPC surface behaves deterministically.
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
  return autoUpdater;
}

function isRpmPackage(resourcesPath: string): boolean {
  try {
    return readFileSync(path.join(resourcesPath, 'package-type'), 'utf8').trim() === 'rpm';
  } catch {
    return false;
  }
}

function defaultCurrentVersion(): string {
  throw new Error('current version unavailable outside Electron');
}

/** Deterministic fake updater driving every phase transition immediately. */
function createFakeUpdater(version: string): UpdaterLike {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  const updater: UpdaterLike = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    disableDifferentialDownload: true,
    disableWebInstaller: true,
    setFeedURL() {},
    async checkForUpdates() {
      emit('update-available', { version });
      if (updater.autoDownload) await updater.downloadUpdate();
    },
    async downloadUpdate() {
      emit('download-progress', { percent: 100 });
      emit('update-downloaded', { version });
    },
    quitAndInstall() {},
    on(event, listener) {
      const entries = listeners.get(event) ?? [];
      entries.push(listener);
      listeners.set(event, entries);
      return { removeListener: () => undefined };
    },
    removeListener(event, listener) {
      const entries = listeners.get(event) ?? [];
      listeners.set(event, entries.filter((entry) => entry !== listener));
      return listeners;
    },
  };
  return updater;
}

function errorMessage(error: unknown): string {
  return serializeError(error).message;
}

function safeVersion(value: string | undefined | null): string {
  return typeof value === 'string' && value.length > 0 ? value : '0.0.0';
}
