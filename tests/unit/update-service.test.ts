import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateService, createUpdateService, type UpdaterLike } from '../../src/main/services/update-service.js';
import type { UpdateStatusPayload } from '../../src/shared/ipc/index.js';

type FakeUpdater = UpdaterLike & {
  listeners: Record<string, Array<(...args: unknown[]) => void>>;
  emit: (event: string, ...args: unknown[]) => void;
};

const scratchDirectories: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'mongog-update-test-'));
  scratchDirectories.push(directory);
  return directory;
}

function configuredResources(): string {
  const directory = scratch();
  writeFileSync(path.join(directory, 'app-update.yml'), readFileSync('build/app-update.yml', 'utf8'));
  return directory;
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFakeUpdater(): FakeUpdater {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners[event] ?? []) listener(...args);
  };
  return {
    listeners,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    disableDifferentialDownload: false,
    disableWebInstaller: false,
    setFeedURL: () => undefined,
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    on: (event, listener) => {
      (listeners[event] ??= []).push(listener);
      return listeners;
    },
    removeListener: (event, listener) => {
      listeners[event] = (listeners[event] ?? []).filter((entry) => entry !== listener);
      return listeners;
    },
    emit,
  };
}

function createService(automaticDownload = false) {
  const updater = createFakeUpdater();
  const broadcasts: UpdateStatusPayload[] = [];
  const service = new UpdateService(
    updater,
    (payload) => broadcasts.push(payload),
    () => '1.2.6',
    undefined,
    automaticDownload,
  );
  return { updater, service, broadcasts };
}

describe('UpdateService', () => {
  it('configures consent-driven full downloads', () => {
    const { updater } = createService();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.disableDifferentialDownload).toBe(true);
    expect(updater.disableWebInstaller).toBe(true);
  });

  it('configures automatic download without install-on-quit when requested', () => {
    const { updater } = createService(true);
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.disableDifferentialDownload).toBe(true);
    expect(updater.disableWebInstaller).toBe(true);
  });

  it('check() broadcasts checking then resolves to the current terminal phase', async () => {
    const { updater, service, broadcasts } = createService();
    const result = service.check();
    expect(broadcasts.at(-1)).toMatchObject({ phase: 'checking' });
    updater.emit('update-not-available');
    await expect(result).resolves.toMatchObject({ phase: 'up-to-date', currentVersion: '1.2.6' });
  });

  it('maps update-available to phase available with version', async () => {
    const { updater, service, broadcasts } = createService();
    const result = service.check();
    updater.emit('update-available', { version: '2.0.0' });
    await expect(result).resolves.toMatchObject({ phase: 'available', version: '2.0.0' });
    expect(broadcasts).toContainEqual({ phase: 'available', version: '2.0.0' });
  });

  it('maps update-available directly to downloading for automatic downloads', async () => {
    const { updater, service, broadcasts } = createService(true);
    const result = service.check();
    updater.emit('update-available', { version: '2.0.0' });
    await expect(result).resolves.toMatchObject({ phase: 'downloading', version: '2.0.0' });
    expect(broadcasts).toContainEqual({ phase: 'downloading', version: '2.0.0' });
    expect(broadcasts).not.toContainEqual({ phase: 'available', version: '2.0.0' });
  });

  it('check() maps a thrown error to phase error and broadcasts it', async () => {
    const { updater, service, broadcasts } = createService();
    updater.checkForUpdates = vi.fn(async () => {
      throw new Error('network down');
    });
    const result = await service.check();
    expect(result.phase).toBe('error');
    expect(broadcasts).toContainEqual({ phase: 'error', error: 'network down' });
  });

  it('redacts credentials and tokens before updater errors cross into renderer state', async () => {
    const { updater, service, broadcasts } = createService();
    updater.checkForUpdates = vi.fn(async () => {
      throw new Error('GET https://alice:hunter2@updates.example/latest.yml?token=abc failed');
    });

    const result = await service.check();

    expect(result.error).toBe(
      'GET https://<redacted>:<redacted>@updates.example/latest.yml?token=<redacted> failed',
    );
    expect(broadcasts.at(-1)).toEqual({
      phase: 'error',
      error: 'GET https://<redacted>:<redacted>@updates.example/latest.yml?token=<redacted> failed',
    });
  });

  it('broadcasts one terminal error when the updater both emits and rejects it', async () => {
    const { updater, service, broadcasts } = createService();
    const failure = new Error('feed unavailable');
    updater.checkForUpdates = vi.fn(async () => {
      updater.emit('error', failure);
      throw failure;
    });

    await expect(service.check()).resolves.toMatchObject({ phase: 'error', error: 'feed unavailable' });
    expect(broadcasts.filter((payload) => payload.phase === 'error')).toEqual([
      { phase: 'error', error: 'feed unavailable' },
    ]);
  });

  it('install() calls downloadUpdate from available and quitAndInstall when downloaded', async () => {
    const { updater, service } = createService();
    await service.check();
    updater.emit('update-available', { version: '2.0.0' });
    await service.install();
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);

    updater.emit('download-progress', { percent: 45 });
    updater.emit('update-downloaded');
    await service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('rejects download requests until an update is available', async () => {
    const { updater, service } = createService();

    await expect(service.install()).rejects.toThrow('must be available');
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('maps download checksum and network failures to the error phase', async () => {
    const { updater, service, broadcasts } = createService();
    updater.emit('update-available', { version: '2.0.0' });
    updater.downloadUpdate = vi.fn(async () => {
      throw new Error('sha512 checksum mismatch');
    });

    await service.install();

    expect(broadcasts).toContainEqual({ phase: 'error', error: 'sha512 checksum mismatch' });
  });

  it('coalesces concurrent checks into one updater request', async () => {
    const { updater, service } = createService();
    let resolveCheck!: () => void;
    updater.checkForUpdates = vi.fn(() => new Promise<void>((resolve) => { resolveCheck = resolve; }));

    const first = service.check();
    const second = service.check();
    updater.emit('update-not-available');
    resolveCheck();

    await expect(first).resolves.toMatchObject({ phase: 'up-to-date' });
    await expect(second).resolves.toMatchObject({ phase: 'up-to-date' });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('does not start another check while downloading or waiting to restart', async () => {
    const { updater, service } = createService();
    updater.emit('update-available', { version: '2.0.0' });
    await service.install();
    await service.check();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();

    updater.emit('update-downloaded');
    await service.check();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('dispose() makes check return not-supported', async () => {
    const { updater, service } = createService();
    service.dispose();
    await expect(service.check()).resolves.toMatchObject({ phase: 'not-supported' });
    expect(Object.values(updater.listeners).flat()).toHaveLength(0);
  });
});

describe('createUpdateService factory', () => {
  it('wires a deterministic fake updater when e2eVersion is set (no network)', async () => {
    const broadcasts: UpdateStatusPayload[] = [];
    const service = await createUpdateService((payload) => broadcasts.push(payload), 'https://x/update', {
      e2eVersion: '9.9.9',
      getCurrentVersion: () => '1.2.6',
    });
    await expect(service.check()).resolves.toMatchObject({
      phase: 'available',
      version: '9.9.9',
      currentVersion: '1.2.6',
    });
    await service.install();
    expect(broadcasts).toContainEqual({ phase: 'downloading', version: '9.9.9' });
    expect(broadcasts).toContainEqual({ phase: 'downloaded', version: '9.9.9' });
    expect(service.isSupported).toBe(true);
  });

  it('makes the deterministic Windows updater download automatically but wait for install consent', async () => {
    const broadcasts: UpdateStatusPayload[] = [];
    const service = await createUpdateService((payload) => broadcasts.push(payload), 'https://x/update', {
      e2eVersion: '9.9.9',
      getCurrentVersion: () => '1.2.6',
      platform: 'win32',
    });

    await expect(service.check()).resolves.toMatchObject({
      phase: 'downloaded',
      version: '9.9.9',
      currentVersion: '1.2.6',
    });
    expect(broadcasts).toContainEqual({ phase: 'downloading', version: '9.9.9' });
    expect(broadcasts).toContainEqual({ phase: 'downloaded', version: '9.9.9' });
    expect(broadcasts).not.toContainEqual({ phase: 'available', version: '9.9.9' });
  });

  it('uses the injected real-updater factory when provided', async () => {
    const realUpdater = createFakeUpdater();
    const createRealUpdater = vi.fn(async () => realUpdater);
    const service = await createUpdateService(() => undefined, 'https://x/update', {
      createRealUpdater,
      getCurrentVersion: () => '1.2.6',
      platform: 'darwin',
      resourcesPath: configuredResources(),
    });
    expect(createRealUpdater).toHaveBeenCalledWith('https://x/update');
    const result = service.check();
    realUpdater.emit('update-not-available');
    await expect(result).resolves.toMatchObject({ phase: 'up-to-date' });
  });

  it('surfaces a redacted initialization error when the real updater factory throws', async () => {
    const service = await createUpdateService(() => undefined, 'https://x/update', {
      createRealUpdater: async () => {
        throw new Error('https://alice:secret@x/update?token=abc is unavailable');
      },
      getCurrentVersion: () => '1.2.6',
      platform: 'darwin',
      resourcesPath: configuredResources(),
    });
    await expect(service.check()).resolves.toMatchObject({
      phase: 'error',
      error: 'https://<redacted>:<redacted>@x/update?token=<redacted> is unavailable',
    });
  });

  it('does not initialize the real updater for unpackaged builds', async () => {
    const createRealUpdater = vi.fn(async () => createFakeUpdater());
    const service = await createUpdateService(() => undefined, 'https://x/update', {
      createRealUpdater,
      getCurrentVersion: () => '1.2.6',
      isPackaged: false,
    });

    await expect(service.check()).resolves.toMatchObject({ phase: 'not-supported' });
    expect(createRealUpdater).not.toHaveBeenCalled();
  });

  it('does not initialize Linux updater without the RPM package marker', async () => {
    const createRealUpdater = vi.fn(async () => createFakeUpdater());
    const service = await createUpdateService(() => undefined, 'https://x/update', {
      createRealUpdater,
      getCurrentVersion: () => '1.2.6',
      isPackaged: true,
      platform: 'linux',
      resourcesPath: '/path/that/does/not/exist',
    });

    await expect(service.check()).resolves.toMatchObject({ phase: 'not-supported' });
    expect(createRealUpdater).not.toHaveBeenCalled();
  });

  it('initializes the Linux updater only for an RPM package marker', async () => {
    const resourcesPath = configuredResources();
    writeFileSync(path.join(resourcesPath, 'package-type'), 'rpm\n');
    const createRealUpdater = vi.fn(async () => createFakeUpdater());
    const service = await createUpdateService(() => undefined, 'https://x/update', {
      createRealUpdater,
      getCurrentVersion: () => '1.2.6',
      isPackaged: true,
      platform: 'linux',
      resourcesPath,
    });

    expect(service.isSupported).toBe(true);
    expect(createRealUpdater).toHaveBeenCalledOnce();
  });

  describe.each(['darwin', 'linux', 'win32'] as const)('%s packaged configuration', (platform) => {
    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['invalid YAML', 'provider: ['],
      ['missing cache directory', 'provider: generic\nurl: https://mongog.com/update\n'],
      ['wrong types', 'provider: [generic]\nurl: https://mongog.com/update\nupdaterCacheDirName: mongog-updater\n'],
    ])('reports actionable reinstall guidance for %s configuration', async (_name, config) => {
      const resourcesPath = scratch();
      if (config !== undefined) writeFileSync(path.join(resourcesPath, 'app-update.yml'), config);
      if (platform === 'linux') writeFileSync(path.join(resourcesPath, 'package-type'), 'rpm\n');
      const createRealUpdater = vi.fn(async () => createFakeUpdater());
      const service = await createUpdateService(() => undefined, 'https://x/update', {
        platform, resourcesPath, createRealUpdater, isPackaged: true, getCurrentVersion: () => '1.2.8',
      });
      await expect(service.check()).resolves.toMatchObject({
        phase: 'error',
        error: expect.stringContaining('Download and reinstall MongoG from https://mongog.com'),
      });
      expect(service.isSupported).toBe(false);
      expect(createRealUpdater).not.toHaveBeenCalled();
      service.dispose();
    });
  });

  it('initializes the unsigned Windows updater from the pinned generic feed', async () => {
    const resourcesPath = configuredResources();
    const updater = createFakeUpdater();
    const createRealUpdater = vi.fn(async () => updater);
    const service = await createUpdateService(() => undefined, 'https://x/update', {
      createRealUpdater,
      getCurrentVersion: () => '1.2.6',
      isPackaged: true,
      platform: 'win32',
      resourcesPath,
    });

    expect(service.isSupported).toBe(true);
    expect(createRealUpdater).toHaveBeenCalledOnce();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });
});
