import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { UpdateService, type UpdaterLike } from '../../../../src/main/services/update-service.js';
import type { UpdateDelivery, UpdateStatusPayload } from '../../../../src/shared/ipc/index.js';

export type FakeUpdater = UpdaterLike & {
  listeners: Record<string, Array<(...args: unknown[]) => void>>;
  emit: (event: string, ...args: unknown[]) => void;
};

const scratchDirectories: string[] = [];

export function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'mongog-update-test-'));
  scratchDirectories.push(directory);
  return directory;
}

export function cleanupUpdateScratch(): void {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function configuredResources(): string {
  const directory = scratch();
  writeFileSync(path.join(directory, 'app-update.yml'), readFileSync('build/app-update.yml', 'utf8'));
  return directory;
}

export function createFakeUpdater(): FakeUpdater {
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

export function createService(delivery: UpdateDelivery = 'in-app') {
  const updater = createFakeUpdater();
  const broadcasts: UpdateStatusPayload[] = [];
  const service = new UpdateService(
    updater,
    (payload) => broadcasts.push(payload),
    () => '1.2.6',
    undefined,
    delivery,
  );
  return { updater, service, broadcasts };
}
