import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUpdateService } from '../../../src/main/services/update-service.js';
import {
  cleanupUpdateScratch,
  configuredResources,
  createFakeUpdater,
  scratch,
} from './helpers/update-service.js';

afterEach(cleanupUpdateScratch);

describe('createUpdateService factory', () => {
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

  it('initializes the unsigned Windows updater for manifest checks only', async () => {
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
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);

    const result = service.check();
    updater.emit('update-available', { version: '2.0.0' });
    await expect(result).resolves.toMatchObject({
      phase: 'available',
      delivery: 'website',
      version: '2.0.0',
    });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });
});
