import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MongoClient } from 'mongodb';
import type { Page } from '@playwright/test';

import { expect } from '../../fixtures/mongog-test.js';
import { redirectOpenDialogs } from '../../helpers/dialogs.js';
import { dragHorizontalSeparator, expectQueryEditorFullHeight, expectViewportLocked, expectWorkspaceSurfaceFullWidth } from '../../helpers/ui.js';
import type { LifecycleContext, LifecycleState } from './context.js';

export async function runWelcomeReleaseAndSettings(context: LifecycleContext): Promise<Page> {
  const page = await context.launch();
  await expectViewportLocked(page);
  await expect(page).toHaveTitle('MongoG');
  await expect(page.getByText('Welcome back')).toBeVisible();
  await expect(page.getByTestId('welcome-mongog-brand')).toHaveAccessibleName('MongoG');
  await expect(page.getByTestId('welcome-mongog-brand').locator('img'))
    .toHaveAttribute('src', /mongog-icon.*\.png/);
  await expect(page.getByTestId('sidebar-mongog-brand')).toHaveAccessibleName('MongoG');
  await expect(page.getByTestId('sidebar-mongog-brand').locator('img'))
    .toHaveAttribute('src', /mongog-icon.*\.png/);
  await expect(page.locator('[title^="welcome: Welcome"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'What’s New in 1.2.22' }).click();
  const releaseNotesTab = page.locator('[data-tab-kind="release-notes"]');
  await expect(page.getByTestId('release-notes-view')).toBeVisible();
  await expect(page.getByTestId('release-notes-mongog-brand')).toHaveAccessibleName('MongoG');
  await expect(page.getByText('Installed v1.2.22')).toBeVisible();
  await expect(page.locator('[data-release-version="1.2.22"]')).toContainText('Latest');
  await expect(page.locator('[data-release-version="1.0.0"]')).toBeVisible();
  await expectViewportLocked(page);
  await releaseNotesTab.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Rename Tab…' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Pin Tab' }).click();
  await expect(releaseNotesTab).toHaveAttribute('data-tab-pinned', 'true');
  await expect(releaseNotesTab.getByTestId('tab-pin-icon')).toBeVisible();
  await releaseNotesTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unpin Tab' }).click();
  await page.getByTitle('Close Release Notes').click();
  await expect(releaseNotesTab).toHaveCount(0);
  await page.locator('[title^="welcome: Welcome"]').click();
  await page.getByRole('button', { name: 'What’s New in 1.2.22' }).click();
  await expect(page.locator('[data-tab-kind="release-notes"]')).toHaveCount(1);
  await expect(page.getByTitle('New query tab')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open global search' })).toBeVisible();
  await expect(page.getByTitle('Open administration')).toHaveCount(0);
  const sidebarHeaderActions = page.getByRole('navigation', { name: 'Connection explorer' })
    .locator('.sidebar-header-action');
  const sidebar = page.getByTestId('connection-explorer');
  const sidebarResizer = page.getByTestId('sidebar-resizer');
  await expect(sidebarResizer).toHaveAttribute('aria-valuenow', '260');
  const sidebarMaximum = Number(await sidebarResizer.getAttribute('aria-valuemax'));
  expect(sidebarMaximum).toBeGreaterThanOrEqual(180);
  await sidebarResizer.focus();
  await sidebarResizer.press('Home');
  await expect(sidebar).toHaveJSProperty('clientWidth', 180);
  await expect(sidebar.locator('[data-sidebar-compact-header="true"]')).toBeVisible();
  await sidebarResizer.press('End');
  // BrowserWindow.setSize() controls the outer window. Windows reserves a
  // frame border, so its 1000px outer width has a 984px content viewport and
  // therefore a 364px accessible sidebar maximum instead of macOS's 380px.
  await expect(sidebar).toHaveJSProperty('clientWidth', sidebarMaximum);
  await sidebarResizer.dblclick();
  await expect(sidebar).toHaveJSProperty('clientWidth', 260);
  await dragHorizontalSeparator(page, sidebarResizer, 80);
  await expect(sidebar).toHaveJSProperty('clientWidth', 340);
  await expectViewportLocked(page);
  await sidebarResizer.dblclick();
  await expect(sidebar).toHaveJSProperty('clientWidth', 260);
  await expect(sidebarHeaderActions).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Open Welcome' }))
    .toHaveAttribute('title', 'Open Welcome — return to the start page');
  await expect(page.getByRole('button', { name: 'New connection', exact: true }))
    .toHaveAttribute('title', 'New Connection — create a connection profile');
  await expect(page.getByRole('button', { name: 'New group' }))
    .toHaveAttribute('title', 'New Group — organize connections in a group');
  await expect.poll(() => sidebarHeaderActions.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return [rect.width, rect.height];
  }))).toEqual([[24, 24], [24, 24], [24, 24]]);
  await expect(page.getByTitle(/MongoG version /)).toContainText(/^v\d+\.\d+\.\d+/);
  await page.getByRole('button', { name: 'Open application settings' }).click();
  await expect(page.locator('[title^="settings: Settings"]')).toBeVisible();
  await expect(page.getByTestId('settings-view')).toBeVisible();
  await page.getByRole('button', { name: 'Open application settings' }).click();
  await expect(page.locator('[title^="settings: Settings"]')).toHaveCount(1);
  await page.getByRole('radio', { name: 'Light theme' }).click();
  await expect(page.getByRole('radio', { name: 'Light theme' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.getByTestId('settings-view').evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  )).toBe('rgb(247, 248, 250)');
  await expect(page.getByRole('radio', { name: 'MongoDB Shell data display' }))
    .toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Documents default collection view' }))
    .toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch', { name: 'Run default collection query automatically' }))
    .toBeDisabled();
  await expect(page.getByLabel('Global page size')).toHaveValue('50');
  await expect(page.getByTestId('about-updates-settings')).toContainText('MongoG 1.2.22');
  await page.getByRole('button', { name: 'Open Release Notes' }).click();
  await expect(page.getByTestId('release-notes-view')).toBeVisible();
  await expect(page.locator('[data-tab-kind="release-notes"]')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expectViewportLocked(page);
  await page.locator('[data-tab-kind="settings"]').click();
  await page.getByRole('radio', { name: 'Canonical EJSON data display' }).click();
  await expect(page.getByRole('radio', { name: 'Canonical EJSON data display' }))
    .toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'MongoDB Shell data display' }).click();
  await page.locator('[title^="welcome: Welcome"]').click();

  return page;
}

export async function runConnectionManagement(
  context: LifecycleContext,
  page: Page,
): Promise<LifecycleState> {
  const { mongoUri, databaseName } = context;
  await page.getByRole('button', { name: 'New Connection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New connection' })).toBeVisible();
  await page.getByLabel('Connection name').fill('E2E Local');
  await page.getByLabel('Connection URI').fill(mongoUri);
  await page.getByLabel('Default database').fill(databaseName);
  await page.getByRole('button', { name: 'advanced' }).click();
  await expect(page.getByText('Authentication & topology')).toBeVisible();
  await page.getByRole('button', { name: 'basic' }).click();
  await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
  await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
  let explorer = page.getByRole('navigation', { name: 'Connection explorer' });
  await expect(explorer.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await expect(explorer.getByRole('button', { name: 'Connection settings for E2E Local' })).toBeVisible();

  return { page, explorer };
}

export async function runDataTransfer(
  context: LifecycleContext,
  state: LifecycleState,
): Promise<void> {
  const { harness, mongoUri, userDataPath, databaseName } = context;
  const { page } = state;
  const importPath = join(userDataPath, 'transfer-products.csv');
  await writeFile(importPath, '\uFEFFsku,description,price\r\n001,"first\nline",1492.00\r\n002,second,8.50\r\n');
  await redirectOpenDialogs(harness.application!, [importPath]);
  await page.getByTitle('Import files or copy collections').click();
  await expect(page.getByRole('heading', { name: 'Data Transfer' })).toBeVisible();
  await expect(page.getByText('Source data is always read-only and is never deleted.')).toBeVisible();
  await expect(page.getByLabel('Target connection')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Choose CSV / XLSX files…' }).click();
  await expect(page.getByRole('button', { name: 'Refresh preview' })).toBeVisible();
  await page.getByLabel('Target collection').fill('transfer_import');
  await page.getByRole('button', { name: 'Start import' }).click();
  const transferJobs = page.getByLabel('Data transfer jobs');
  await expect(transferJobs.getByText('completed', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => {
    const verify = new MongoClient(mongoUri);
    await verify.connect();
    try {
      return await verify.db(databaseName).collection('transfer_import').countDocuments();
    } finally {
      await verify.close();
    }
  }).toBe(2);

}

export async function runGroupManagement(state: LifecycleState): Promise<void> {
  const { page, explorer } = state;
  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByPlaceholder('Group name').fill('E2E Group');
  await page.getByPlaceholder('Group name').press('Enter');
  const groupNode = explorer.getByRole('treeitem', { name: 'Group E2E Group' });
  const initialProfileNode = explorer.getByRole('treeitem', { name: 'Connection E2E Local' });
  await initialProfileNode.dragTo(groupNode);
  await expect(groupNode.locator('..').getByRole('treeitem', { name: 'Connection E2E Local' })).toBeVisible();
  await explorer.getByRole('button', { name: 'Collapse group E2E Group' }).click();
  await expect(groupNode.locator('..').getByRole('treeitem', { name: 'Connection E2E Local' })).toHaveCount(0);
  await explorer.getByRole('button', { name: 'Expand group E2E Group' }).click();
  await expect(groupNode.locator('..').getByRole('treeitem', { name: 'Connection E2E Local' })).toBeVisible();
  await groupNode.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename Group…' }).click();
  const renameGroupDialog = page.getByRole('dialog', { name: 'Rename group' });
  await renameGroupDialog.getByRole('textbox').fill('E2E Renamed Group');
  await renameGroupDialog.getByRole('textbox').press('Enter');
  await expect(explorer.getByRole('treeitem', { name: 'Group E2E Renamed Group' })).toBeVisible();
}

export async function runWelcomeConnectionsAndGroups(context: LifecycleContext): Promise<LifecycleState> {
  const page = await runWelcomeReleaseAndSettings(context);
  const connected = await runConnectionManagement(context, page);
  await runDataTransfer(context, connected);
  await runGroupManagement(connected);
  return connected;
}
