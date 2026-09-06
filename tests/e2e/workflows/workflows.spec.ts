import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Locator, Page } from '@playwright/test';
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

test('Query font zoom and Documents Criteria defaults are scoped and persistent', async ({ mongog }, testInfo) => {
  const harness = createE2EHarness(mongog);
  const { launch, closeApplication, mongoUri, userDataPath, databaseName } = harness;
  const isolatedUserData = await mkdtemp(join(tmpdir(), 'mongog-zoom-e2e-'));
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  let page: Page;
  const openSettings = async () => {
    await page.getByRole('button', { name: 'Open application settings' }).click();
    await expect(page.getByText('Preferences are saved automatically.')).toBeVisible();
  };
  const waitForSave = async () => {
    await expect(page.getByText('Preferences are saved automatically.')).toBeVisible();
  };
  const queryLines = () => page.getByTestId('query-editor-surface').locator('.view-lines');
  const zoom = async (deltaY: number) => {
    await page.getByTestId('query-editor-surface').hover();
    await page.keyboard.down(modifier);
    await page.mouse.wheel(0, deltaY);
    await page.keyboard.up(modifier);
  };
  try {
    page = await launch({ MONGOG_E2E_USER_DATA: isolatedUserData });
    await openSettings();
    const fontSize = page.getByLabel('Query font size');
    await expect(fontSize).toHaveValue('13');
    await expect(page.getByRole('switch', { name: 'Query mouse wheel zoom' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('switch', { name: 'Open Documents criteria by default' })).toHaveAttribute('aria-checked', 'true');
    for (const invalid of ['7', '73', '13.5']) {
      await fontSize.fill(invalid);
      await fontSize.press('Enter');
      await expect(fontSize).toHaveAttribute('aria-invalid', 'true');
      expect(await page.evaluate(async () => (await window.mongog.settings.load()).editor.fontSize)).toBe(13);
    }
    await fontSize.fill('18');
    await fontSize.press('Enter');
    await waitForSave();

    await page.getByTitle('New query tab').click();
    const queryTabId = await page.locator('[data-tab-kind="query"][data-tab-active="true"]').getAttribute('data-tab-id');
    await expect(queryLines()).toHaveCSS('font-size', '18px');
    await setQueryEditorValue(page, 'const zoomMarker = 1;');
    await page.getByTestId('query-editor-surface').locator('.monaco-editor').evaluate((editor) => {
      editor.setAttribute('data-zoom-instance', 'original');
    });
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await zoom(-120);
    await expect(queryLines()).toHaveCSS('font-size', '19px');
    await expect(page.locator('[data-zoom-instance="original"]')).toHaveCount(1);
    await page.keyboard.insertText('X');
    await expect(queryLines()).toContainText('X');
    await expect(queryLines()).not.toContainText('zoomMarker');
    await page.keyboard.press(`${modifier}+z`);
    await expect(queryLines()).toContainText('const zoomMarker = 1;');

    await setQueryEditorValue(page, Array.from({ length: 120 }, (_, index) => `// scroll line ${index}`).join('\n'));
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    await expect(queryLines()).toContainText('scroll line 0');
    await page.getByTestId('query-editor-surface').hover();
    await page.mouse.wheel(0, 600);
    await expect(queryLines()).not.toContainText('scroll line 0');
    await expect(queryLines()).toHaveCSS('font-size', '19px');
    expect(await harness.application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor())).toBe(1);
    await openSettings();
    await expect(fontSize).toHaveValue('19');

    await page.getByRole('button', { name: 'Open Welcome' }).click();
    await page.getByRole('button', { name: 'New Connection', exact: true }).click();
    await page.getByLabel('Connection name').fill('Zoom E2E');
    await page.getByLabel('Connection URI').fill(mongoUri);
    await page.getByLabel('Default database').fill(databaseName);
    await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
    await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
    const explorer = page.getByRole('navigation', { name: 'Connection explorer' });
    const profile = explorer.getByRole('treeitem', { name: 'Connection Zoom E2E' });
    await profile.focus();
    await profile.press('ArrowRight');
    const database = explorer.getByRole('treeitem', { name: `Database ${databaseName}` });
    await expect(database).toBeVisible({ timeout: 15_000 });
    await database.focus();
    await database.press('ArrowRight');
    const collection = page.getByTitle(`Open ${databaseName}.inventory`);
    await collection.click();
    const firstTabId = await page.locator('[data-tab-kind="collection"][data-tab-active="true"]').getAttribute('data-tab-id');
    const firstCriteria = page.locator(`button[aria-controls="criteria-${firstTabId}"]`);
    await expect(firstCriteria).toHaveAttribute('aria-expanded', 'true');
    await setMonacoValue(page, 'Collection filter', '{ sku: "alpha" }');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByRole('row', { name: /alpha/ })).toBeVisible();

    await openSettings();
    await page.getByRole('switch', { name: 'Open Documents criteria by default' }).click();
    await waitForSave();
    await page.getByRole('radio', { name: 'Always open a new tab for Explorer collections' }).click();
    await waitForSave();
    await page.locator(`[data-tab-id="${firstTabId}"]`).click();
    await expect(firstCriteria).toHaveAttribute('aria-expanded', 'true');
    await firstCriteria.click();
    await page.getByRole('button', { name: 'Query', exact: true }).click();
    await expect(queryLines()).toHaveCSS('font-size', '19px');
    await zoom(-120);
    await expect(queryLines()).toHaveCSS('font-size', '20px');
    await page.getByRole('button', { name: 'Documents', exact: true }).click();
    await expect(firstCriteria).toHaveAttribute('aria-expanded', 'false');
    await firstCriteria.click();
    await expect(page.getByTestId('criteria-editor-filter').locator('.view-lines')).toHaveCSS('font-size', '12px');
    await expect(page.getByTestId('criteria-editor-filter')).toContainText('alpha');
    await expect(page.getByRole('row', { name: /alpha/ })).toBeVisible();

    await collection.click();
    const secondTabId = await page.locator('[data-tab-kind="collection"][data-tab-active="true"]').getAttribute('data-tab-id');
    expect(secondTabId).not.toBe(firstTabId);
    await expect(page.locator(`button[aria-controls="criteria-${secondTabId}"]`)).toHaveAttribute('aria-expanded', 'false');
    await page.locator(`[data-tab-id="${firstTabId}"]`).click();
    await expect(firstCriteria).toHaveAttribute('aria-expanded', 'true');
    await page.locator(`[data-tab-id="${queryTabId}"]`).click();
    await expect(queryLines()).toHaveCSS('font-size', '20px');

    await openSettings();
    await page.getByRole('switch', { name: 'Query mouse wheel zoom' }).click();
    await waitForSave();
    await page.getByTestId('query-editor-settings').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('query-settings.png') });
    const persistedWorkspace = await page.evaluate(() => window.mongog.workspace.load());
    expect(persistedWorkspace?.tabs.every((tab) => !('documentsCriteriaOpen' in tab))).toBe(true);
    await closeApplication();

    page = await launch({ MONGOG_E2E_USER_DATA: isolatedUserData });
    await openSettings();
    await expect(page.getByLabel('Query font size')).toHaveValue('20');
    await expect(page.getByRole('switch', { name: 'Query mouse wheel zoom' })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('switch', { name: 'Open Documents criteria by default' })).toHaveAttribute('aria-checked', 'false');
    // Restored tabs capture the startup preference even before their first activation.
    await page.getByRole('switch', { name: 'Open Documents criteria by default' }).click();
    await waitForSave();
    await page.locator(`[data-tab-id="${firstTabId}"]`).click();
    const restoredCriteria = page.locator(`button[aria-controls="criteria-${firstTabId}"]`);
    await expect(restoredCriteria).toHaveAttribute('aria-expanded', 'false');
    await restoredCriteria.click();
    await expect(page.getByTestId('criteria-editor-filter')).toContainText('alpha');
    await page.locator(`[data-tab-id="${queryTabId}"]`).click();
    await expect(queryLines()).toHaveCSS('font-size', '20px');
    await zoom(-120);
    await expect(queryLines()).toHaveCSS('font-size', '20px');
    expect(await harness.application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor())).toBe(1);
    await openSettings();
    await page.getByRole('switch', { name: 'Query mouse wheel zoom' }).click();
    await waitForSave();
    await page.locator(`[data-tab-id="${queryTabId}"]`).click();
    await zoom(120);
    await expect(queryLines()).toHaveCSS('font-size', '19px');
  } finally {
    try { await closeApplication(); } finally { await removeElectronUserData(isolatedUserData); }
  }
});
