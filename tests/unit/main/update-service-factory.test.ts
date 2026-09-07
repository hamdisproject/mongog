import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUpdateService } from '../../../src/main/services/update-service.js';
import type { UpdateStatusPayload } from '../../../src/shared/ipc/index.js';
import {
  cleanupUpdateScratch,
  configuredResources,
  createFakeUpdater,
  scratch,
} from './helpers/update-service.js';

afterEach(cleanupUpdateScratch);

describe('createUpdateService factory', () => {
  it('wires a deterministic fake updater when e2eVersion is set (no network)', async () => {
    const broadcasts: UpdateStatusPayload[] = [];
    const service = await createUpdateService((payload) => broadcasts.push(payload), 'https://x/update', {
      e2eVersion: '9.9.9',
      getCurrentVersion: () => '1.2.6',
      platform: 'darwin',
    });
    await expect(service.check()).resolves.toMatchObject({
      phase: 'available',
      version: '9.9.9',
      currentVersion: '1.2.6',
    });
    await service.install();
    expect(broadcasts).toContainEqual({ phase: 'downloading', delivery: 'in-app', version: '9.9.9' });
    expect(broadcasts).toContainEqual({ phase: 'downloaded', delivery: 'in-app', version: '9.9.9' });
    expect(service.isSupported).toBe(true);
  });

  it('uses the deterministic Windows updater for version checks without downloading', async () => {
    const broadcasts: UpdateStatusPayload[] = [];
    const service = await createUpdateService((payload) => broadcasts.push(payload), 'https://x/update', {
      e2eVersion: '9.9.9',
      getCurrentVersion: () => '1.2.6',
      platform: 'win32',
    });

    await expect(service.check()).resolves.toMatchObject({
      phase: 'available',
      delivery: 'website',
      version: '9.9.9',
      currentVersion: '1.2.6',
    });
    expect(broadcasts).toContainEqual({ phase: 'available', delivery: 'website', version: '9.9.9' });
    expect(broadcasts.some((payload) => payload.phase === 'downloading')).toBe(false);
    expect(broadcasts.some((payload) => payload.phase === 'downloaded')).toBe(false);
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
});
