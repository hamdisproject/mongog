import { describe, expect, it, vi } from 'vitest';
import { createService } from './helpers/update-service.js';

describe('UpdateService', () => {
  it('configures consent-driven full downloads', () => {
    const { updater } = createService();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.disableDifferentialDownload).toBe(true);
    expect(updater.disableWebInstaller).toBe(true);
  });

  it('keeps package downloads disabled for website delivery', () => {
    const { updater } = createService('website');
    expect(updater.autoDownload).toBe(false);
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
    expect(broadcasts).toContainEqual({ phase: 'available', delivery: 'in-app', version: '2.0.0' });
  });

  it('maps website-delivered updates to available without starting a download', async () => {
    const { updater, service, broadcasts } = createService('website');
    const result = service.check();
    updater.emit('update-available', { version: '2.0.0' });
    await expect(result).resolves.toMatchObject({ phase: 'available', delivery: 'website', version: '2.0.0' });
    expect(broadcasts).toContainEqual({ phase: 'available', delivery: 'website', version: '2.0.0' });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('check() maps a thrown error to phase error and broadcasts it', async () => {
    const { updater, service, broadcasts } = createService();
    updater.checkForUpdates = vi.fn(async () => {
      throw new Error('network down');
    });
    const result = await service.check();
    expect(result.phase).toBe('error');
    expect(broadcasts).toContainEqual({ phase: 'error', delivery: 'in-app', error: 'network down' });
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
      delivery: 'in-app',
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
      { phase: 'error', delivery: 'in-app', error: 'feed unavailable' },
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

  it('rejects in-app installation for website delivery without downloading or installing', async () => {
    const { updater, service } = createService('website');
    const result = service.check();
    updater.emit('update-available', { version: '2.0.0' });
    await result;

    await expect(service.install()).rejects.toThrow('disabled on Windows');
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('ignores stale download events for website delivery', async () => {
    const { updater, service, broadcasts } = createService('website');
    const result = service.check();
    updater.emit('update-available', { version: '2.0.0' });
    await result;

    updater.emit('download-progress', { percent: 100 });
    updater.emit('update-downloaded', { version: '2.0.0' });

    expect(broadcasts.at(-1)).toMatchObject({
      phase: 'available',
      delivery: 'website',
      version: '2.0.0',
    });
    expect(broadcasts.some((payload) => payload.phase === 'downloading')).toBe(false);
    expect(broadcasts.some((payload) => payload.phase === 'downloaded')).toBe(false);
  });

  it('maps download checksum and network failures to the error phase', async () => {
    const { updater, service, broadcasts } = createService();
    updater.emit('update-available', { version: '2.0.0' });
    updater.downloadUpdate = vi.fn(async () => {
      throw new Error('sha512 checksum mismatch');
    });

    await service.install();

    expect(broadcasts).toContainEqual({ phase: 'error', delivery: 'in-app', error: 'sha512 checksum mismatch' });
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
