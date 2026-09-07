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

test('workspace tabs use a thin independent scrollbar and reveal the active tab', async ({ mongog }) => {
  const harness = createE2EHarness(mongog);
  const { launch, closeApplication, mongoUri, userDataPath, databaseName } = harness;
  const isolated = await mkdtemp(join(tmpdir(), 'mongog-tab-scroll-'));
  try {
    const page = await launch({ MONGOG_E2E_USER_DATA: isolated });
    const actions = page.getByTestId('workspace-tab-actions');
    const tabViewport = page.getByTestId('workspace-tab-viewport');
    const tabScroll = page.getByTestId('workspace-tab-scroll');
    const newQuery = page.getByTitle('New query tab');
    await expect(page.getByTestId('workspace-tab-scrollbar')).toHaveCount(0);
    const initialActions = await actions.boundingBox();
    if (!initialActions) throw new Error('Expected workspace tab actions bounds');

    for (let index = 0; index < 12; index += 1) await newQuery.click();
    await expect.poll(() => tabScroll.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeGreaterThan(0);
    await expect.poll(() => tabScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    const scrollbar = page.getByTestId('workspace-tab-scrollbar');
    const thumb = page.getByTestId('workspace-tab-scrollbar-thumb');
    await expect(scrollbar).toBeAttached();
    await expect(scrollbar).toHaveCSS('height', '4px');

    await tabScroll.evaluate((element) => { element.scrollLeft = 0; });
    await expect(scrollbar).toHaveCSS('opacity', '0');
    await tabScroll.hover();
    await expect(scrollbar).toHaveCSS('opacity', '1');
    await expect.poll(() => tabScroll.evaluate((element) => element.scrollLeft)).toBe(0);
    await page.mouse.wheel(0, 320);
    await expect.poll(() => tabScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    await scrollbar.focus();
    await scrollbar.press('Home');
    await expect.poll(() => tabScroll.evaluate((element) => element.scrollLeft)).toBe(0);
    await scrollbar.press('ArrowRight');
    await expect.poll(() => tabScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await scrollbar.press('End');
    await expect.poll(async () => tabScroll.evaluate((element) => ({
      scrollLeft: element.scrollLeft,
      max: element.scrollWidth - element.clientWidth,
    }))).toMatchObject({
      scrollLeft: expect.any(Number),
      max: expect.any(Number),
    });
    await expect.poll(() => tabScroll.evaluate((element) => (
      Math.abs(element.scrollLeft - (element.scrollWidth - element.clientWidth))
    ))).toBeLessThanOrEqual(1);

    await scrollbar.press('Home');
    await expect.poll(() => tabScroll.evaluate((element) => element.scrollLeft)).toBe(0);
    const trackBounds = await scrollbar.boundingBox();
    const trackClickThumbBounds = await thumb.boundingBox();
    if (!trackBounds) throw new Error('Expected custom tab scrollbar bounds');
    if (!trackClickThumbBounds) throw new Error('Expected custom tab scrollbar thumb bounds');
    const trackRight = trackBounds.x + trackBounds.width;
    const thumbRight = trackClickThumbBounds.x + trackClickThumbBounds.width;
    expect(trackRight).toBeGreaterThan(thumbRight);
    await page.mouse.click(thumbRight + (trackRight - thumbRight) / 2, trackBounds.y + 2);
    await expect.poll(() => tabScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    await scrollbar.press('Home');
    const thumbBounds = await thumb.boundingBox();
    if (!thumbBounds) throw new Error('Expected custom tab scrollbar thumb bounds');
    await page.mouse.move(thumbBounds.x + thumbBounds.width / 2, thumbBounds.y + 2);
    await page.mouse.down();
    await page.mouse.move(thumbBounds.x + thumbBounds.width / 2 + 60, thumbBounds.y + 2);
    await page.mouse.up();
    await expect.poll(() => tabScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    await tabScroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect.poll(() => tabScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    const scrolledActions = await actions.boundingBox();
    if (!scrolledActions) throw new Error('Expected scrolled workspace tab actions bounds');
    expect(Math.abs(scrolledActions.x - initialActions.x)).toBeLessThanOrEqual(1);
    await expect(newQuery).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open global search' })).toBeVisible();
    await expect(page.getByTitle('Import files or copy collections')).toBeVisible();

    const tabs = tabScroll.locator('[data-tab-id]');
    const firstTab = tabs.first();
    const lastTab = tabs.last();
    await firstTab.locator('[data-tab-select]').evaluate((element: HTMLElement) => element.click());
    await expect(firstTab).toHaveAttribute('data-tab-active', 'true');
    await expect.poll(() => tabScroll.evaluate((element) => element.scrollLeft)).toBe(0);

    await lastTab.locator('[data-tab-select]').evaluate((element: HTMLElement) => element.click());
    await expect(lastTab).toHaveAttribute('data-tab-active', 'true');
    await expect.poll(async () => {
      const viewport = await tabScroll.boundingBox();
      const active = await lastTab.boundingBox();
      if (!viewport || !active) return false;
      return active.x >= viewport.x - 1 &&
        active.x + active.width <= viewport.x + viewport.width + 1;
    }).toBe(true);
    await expectViewportLocked(page);
  } finally {
    try { await closeApplication(); } finally { await removeElectronUserData(isolated); }
  }
});

test('quitting with a pending window-state save exits cleanly', async ({ mongog }) => {
  const harness = createE2EHarness(mongog);
  const { launch, closeApplication, mongoUri, userDataPath, databaseName } = harness;
  const page = await launch();
  await expect(page.getByRole('button', { name: 'Open application settings' })).toBeVisible();
  // A renderer can take time to unload. The debounced resize save must remain
  // valid until the window closes, even after before-quit has been emitted.
  await page.evaluate(() => {
    window.addEventListener('beforeunload', () => {
      const until = Date.now() + 1_200;
      while (Date.now() < until) { /* simulate a busy renderer during unload */ }
    });
  });
  await harness.application!.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    const bounds = window.getBounds();
    window.setBounds({ ...bounds, width: bounds.width + 1 });
  });
  await closeApplication();
});
