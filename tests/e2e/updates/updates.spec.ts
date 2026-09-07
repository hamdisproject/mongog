import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Locator } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { expect, test } from '../fixtures/mongog-test.js';
import { redirectOpenDialogs, redirectSaveDialogs } from '../helpers/dialogs.js';
import { removeElectronUserData } from '../helpers/electron-lifecycle.js';
import { createE2EHarness } from '../helpers/harness.js';
import {
  collectionColumnNames,
  dragHorizontalSeparator,
  dragVerticalSeparator,
  expectCancelBelowSpinner,
  expectQueryColumnsFillWidth,
  expectQueryEditorFullHeight,
  expectQueryErrorOnLine,
  expectViewportLocked,
  expectWorkspaceSurfaceFullWidth,
  queryColumnNames,
  setEditorValueByLabel,
  setMonacoValue,
  setQueryEditorValue,
} from '../helpers/ui.js';
import { inspectUpdateConfiguration, startUpdateFeed } from '../helpers/updates.js';

test('update available is surfaced in the sidebar after consent is declined', async ({ mongog }) => {
  const harness = createE2EHarness(mongog);
  const { launch, closeApplication, mongoUri, userDataPath, databaseName } = harness;
  let page = await launch({ MONGOG_UPDATE_E2E_VERSION: '9.9.9' });
  const websiteDelivery = process.platform === 'win32';
  // Decline the startup action; the update stays 'available' and the sidebar
  // badge + Updates tab remain reachable.
  page.once('dialog', (dialog) => dialog.dismiss());

  const updateButton = page.getByRole('button', {
    name: 'Update 9.9.9 available',
  });
  await expect(updateButton).toBeVisible();
  await expect(page.getByTitle(/MongoG version /)).toContainText('v1.2.21');

  await updateButton.click();
  await expect(page.getByTestId('updates-view')).toBeVisible();
  await expect(page.locator('[data-tab-kind="updates"]')).toHaveCount(1);
  await expect(page.getByText('A new version (v9.9.9) is available.', { exact: true })).toBeVisible();
  if (websiteDelivery) {
    const downloadLink = page.getByRole('link', { name: 'Download from mongog.com' });
    await expect(downloadLink).toHaveAttribute('href', 'https://mongog.com/releases');
    await expect(downloadLink).toHaveAttribute('target', '_blank');
    await expect(page.getByRole('button', { name: 'Download now' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restart & Install' })).toHaveCount(0);
  } else {
    await expect(page.getByRole('button', { name: 'Download now' })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Remind me later' })).toBeVisible();
  await expect(page.getByText("What's new in v9.9.9", { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Remind me later' }).click();
  await expect(updateButton).toHaveCount(0);
});

test('update available exposes the platform delivery action', async ({ mongog }) => {
  const harness = createE2EHarness(mongog);
  const { launch, closeApplication, mongoUri, userDataPath, databaseName } = harness;
  let page = await launch({ MONGOG_UPDATE_E2E_VERSION: '9.9.9' });
  const websiteDelivery = process.platform === 'win32';
  // If the startup consent prompt appears before we attach this handler,
  // Playwright auto-dismisses it (declare intent explicitly for clarity): that
  // keeps the phase 'available' so we can inspect the platform action below.
  page.once('dialog', (dialog) => dialog.dismiss());

  const sidebarBadge = page.getByRole('button', {
    name: 'Update 9.9.9 available',
  });
  await expect(sidebarBadge).toBeVisible();
  await sidebarBadge.click();
  await expect(page.getByTestId('updates-view')).toBeVisible();
  await expect(page.locator('[data-tab-kind="updates"]')).toHaveCount(1);
  if (websiteDelivery) {
    const downloadLink = page.getByRole('link', { name: 'Download from mongog.com' });
    await expect(downloadLink).toHaveAttribute('href', 'https://mongog.com/releases');
    await expect(page.getByRole('button', { name: 'Download now' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restart & Install' })).toHaveCount(0);
  } else {
    const downloadButton = page.getByRole('button', { name: 'Download now' });
    await expect(downloadButton).toBeVisible();
    await downloadButton.click();
    const restartButton = page.getByRole('button', { name: 'Restart & Install' });
    await expect(restartButton).toBeVisible();
    await expect(page.getByText('Download finished. Restart the app to install.', { exact: true }))
      .toBeVisible();
  }
});

test('packaged updater follows the platform download policy with a real generic feed', async ({ mongog }) => {
  const harness = createE2EHarness(mongog);
  const { launch, closeApplication, mongoUri, userDataPath, databaseName } = harness;
  const cachePath = await mkdtemp(join(tmpdir(), 'mongog-update-cache-e2e-'));
  const feed = await startUpdateFeed('9.9.9');
  const websiteDelivery = process.platform === 'win32';
  try {
    const page = await launch({
      MONGOG_UPDATE_FEED_URL: feed.url,
      MONGOG_UPDATE_E2E_VERSION: '',
      MONGOG_UPDATE_E2E_CACHE_PATH: cachePath,
    });
    page.once('dialog', (dialog) => dialog.dismiss());
    await inspectUpdateConfiguration(harness.application!, cachePath);

    await expect.poll(() => feed.requests).toContain(`/update/${feed.manifest}`);
    const badge = page.getByRole('button', {
      name: 'Update 9.9.9 available',
    });
    await expect(badge).toBeVisible();
    await badge.click();
    if (websiteDelivery) {
      await expect(page.getByRole('link', { name: 'Download from mongog.com' }))
        .toHaveAttribute('href', 'https://mongog.com/releases');
      expect(feed.requests).not.toContain(`/update/${feed.artifact}`);
      await expect(page.getByRole('button', { name: 'Download now' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Restart & Install' })).toHaveCount(0);
    } else {
      await expect(page.getByRole('button', { name: 'Download now' })).toBeVisible();
      expect(feed.requests).not.toContain(`/update/${feed.artifact}`);
      await page.getByRole('button', { name: 'Download now' }).click();
      await expect.poll(() => feed.requests).toContain(`/update/${feed.artifact}`);
      await expect(page.getByRole('button', { name: 'Restart & Install' })).toBeVisible();
      await expect(page.getByText('Download finished. Restart the app to install.', { exact: true })).toBeVisible();
      const downloaded = await readFile(join(cachePath, 'mongog-updater', 'pending', feed.artifact));
      expect(createHash('sha512').update(downloaded).digest('base64')).toBe(feed.sha512);
    }
    // Deliberately do not install the fixture. Real NSIS/Squirrel/RPM installation
    // remains protected by the separate user restart action.
  } finally {
    try { await closeApplication(); } finally {
      await feed.close();
      await removeElectronUserData(cachePath);
    }
  }
});

for (const failure of ['checksum', 'http'] as const) {
  test(`packaged updater rejects a real ${failure} download failure`, async ({ mongog }) => {
    test.skip(process.platform === 'win32', 'Windows never downloads update artifacts in-app.');
    const harness = createE2EHarness(mongog);
    const { launch, closeApplication } = harness;
    const cachePath = await mkdtemp(join(tmpdir(), 'mongog-update-failure-e2e-'));
    const feed = await startUpdateFeed('9.9.9', failure);
    try {
      const page = await launch({
        MONGOG_UPDATE_FEED_URL: feed.url,
        MONGOG_UPDATE_E2E_VERSION: '',
        MONGOG_UPDATE_E2E_CACHE_PATH: cachePath,
      });
      page.once('dialog', (dialog) => dialog.dismiss());
      await inspectUpdateConfiguration(harness.application!, cachePath);
      await page.getByRole('button', { name: 'Update 9.9.9 available' }).click();
      expect(feed.requests).not.toContain(`/update/${feed.artifact}`);
      await page.getByRole('button', { name: 'Download now' }).click();
      await expect.poll(() => feed.requests).toContain(`/update/${feed.artifact}`);
      await expect(page.getByTestId('updates-view')).toContainText(failure === 'checksum' ? /checksum mismatch/i : /503/);
      await expect(page.getByRole('button', { name: 'Restart & Install' })).toHaveCount(0);
      await expect(page.getByText('Download finished. Restart the app to install.', { exact: true })).toHaveCount(0);
      expect(existsSync(join(cachePath, 'mongog-updater', 'pending', feed.artifact))).toBe(false);
    } finally {
      try { await closeApplication(); } finally {
        await feed.close();
        await removeElectronUserData(cachePath);
      }
    }
  });
}

test('Updates tab is reachable from Settings and shows the neutral state without a badge', async ({ mongog }) => {
  const harness = createE2EHarness(mongog);
  const { launch, closeApplication, mongoUri, userDataPath, databaseName } = harness;
  let page = await launch();
  await expect(page.getByTitle(/MongoG version /)).toContainText('v1.2.21');
  await expect(page.getByRole('button', { name: /^Update .* available$/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open application settings' }).click();
  await expect(page.getByTestId('settings-view')).toBeVisible();
  await page.getByRole('button', { name: 'Updates', exact: true }).click();
  await expect(page.getByTestId('updates-view')).toBeVisible();
  await expect(page.locator('[data-tab-kind="updates"]')).toHaveCount(1);
  // The neutral launch points at an unreachable feed, so the check errors rather
  // than reporting an update — no success/"available" text should be shown.
  await expect(page.getByText('You are up to date.', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/A new version/)).toHaveCount(0);
});
