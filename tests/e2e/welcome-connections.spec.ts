import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { redactForLog } from '../../src/shared/redaction/index.js';
import { closeElectron, removeElectronUserData } from './helpers/electron-lifecycle.js';

let mongo: MongoMemoryReplSet;
let mongoUri: string;
let userDataPath: string;
let application: ElectronApplication | null = null;
let launchNumber = 0;

test.beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ args: ['--setParameter', 'enableTestCommands=1'] }],
  });
  mongoUri = mongo.getUri('mongog_e2e');
  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    await client.db('mongog_e2e').collection('inventory').insertMany([
      {
        sku: 'alpha',
        quantity: 3,
        amenities: ['wifi', 'balcony'],
        catalog: {
          city: 'Istanbul',
          products: [
            { name: 'Computer Pro', price: 150, tags: ['wifi'] },
            { name: 'Accessory', price: 300 },
          ],
        },
      },
      {
        sku: 'beta',
        quantity: 7,
        amenities: ['pool'],
        catalog: {
          city: '',
          products: [
            { name: 'Computer Basic', price: 300 },
            { name: 'Accessory', price: 150 },
          ],
        },
      },
    ]);
  } finally {
    await client.close();
  }
  userDataPath = await mkdtemp(join(tmpdir(), 'mongog-e2e-'));
});

test.afterEach(async () => {
  await closeApplication();
});

test.afterAll(async () => {
  try {
    await closeApplication();
  } finally {
    await mongo?.stop();
    if (userDataPath) await removeElectronUserData(userDataPath);
  }
});

test('Welcome, Connections, and Collection Query provide the complete lifecycle', async () => {
  let page = await launch();
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
  await page.getByRole('button', { name: 'What’s New in 1.2.12' }).click();
  const releaseNotesTab = page.locator('[data-tab-kind="release-notes"]');
  await expect(page.getByTestId('release-notes-view')).toBeVisible();
  await expect(page.getByTestId('release-notes-mongog-brand')).toHaveAccessibleName('MongoG');
  await expect(page.getByText('Installed v1.2.12')).toBeVisible();
  await expect(page.locator('[data-release-version="1.2.12"]')).toContainText('Latest');
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
  await page.getByRole('button', { name: 'What’s New in 1.2.12' }).click();
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
  await expect(page.getByTestId('about-updates-settings')).toContainText('MongoG 1.2.12');
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

  await page.getByRole('button', { name: 'New Connection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New connection' })).toBeVisible();
  await page.getByLabel('Connection name').fill('E2E Local');
  await page.getByLabel('Connection URI').fill(mongoUri);
  await page.getByLabel('Default database').fill('mongog_e2e');
  await page.getByRole('button', { name: 'advanced' }).click();
  await expect(page.getByText('Authentication & topology')).toBeVisible();
  await page.getByRole('button', { name: 'basic' }).click();
  await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
  await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
  let explorer = page.getByRole('navigation', { name: 'Connection explorer' });
  await expect(explorer.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await expect(explorer.getByRole('button', { name: 'Connection settings for E2E Local' })).toBeVisible();

  const importPath = join(userDataPath, 'transfer-products.csv');
  await writeFile(importPath, '\uFEFFsku,description,price\r\n001,"first\nline",1492.00\r\n002,second,8.50\r\n');
  await redirectOpenDialogs(application!, [importPath]);
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
      return await verify.db('mongog_e2e').collection('transfer_import').countDocuments();
    } finally {
      await verify.close();
    }
  }).toBe(2);

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

  await page.locator('[title^="welcome: Welcome"]').click();
  await page.getByRole('button', { name: /E2E Local CONNECTED/ }).click();
  await expect(page.locator('[title^="query: E2E Local · mongog_e2e"]')).toBeVisible();
  await expect(page.getByTestId('query-results-region')).toHaveCount(0);
  await expectWorkspaceSurfaceFullWidth(page, 'query-editor');
  await expectQueryEditorFullHeight(page);

  await page.getByRole('button', { name: 'Open global search' }).click();
  const preRestartSearch = page.getByLabel('Search databases and collections');
  await preRestartSearch.fill('inventory');
  await expect(page.getByRole('option', { name: /inventory/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('option', { name: /inventory/ }).click();
  const queryTab = page.locator('[data-tab-kind="query"]').first();
  const collectionTab = page.locator('[data-tab-kind="collection"]').first();
  const queryTabId = await queryTab.getAttribute('data-tab-id');
  let collectionTabId = await collectionTab.getAttribute('data-tab-id');
  if (!queryTabId || !collectionTabId) throw new Error('Expected query and collection tab ids');

  await expect(queryTab).not.toHaveAttribute('draggable', 'true');
  await expect(queryTab.locator('[data-tab-drag-handle]')).toHaveAttribute('draggable', 'true');
  const queryCloseButton = queryTab.locator('[data-tab-close]');
  await expect(queryCloseButton).toBeVisible();
  const queryCloseBox = await queryCloseButton.boundingBox();
  expect(queryCloseBox?.width).toBeGreaterThanOrEqual(24);
  expect(queryCloseBox?.height).toBeGreaterThanOrEqual(24);

  await queryTab.locator('[data-tab-select]').click();
  await expect(queryTab).toHaveAttribute('data-tab-active', 'true');
  await collectionTab.locator('[data-tab-select]').focus();
  await page.keyboard.press('Space');
  await expect(collectionTab).toHaveAttribute('data-tab-active', 'true');
  await queryTab.locator('[data-tab-select]').focus();
  await page.keyboard.press('Enter');
  await expect(queryTab).toHaveAttribute('data-tab-active', 'true');
  await collectionTab.locator('[data-tab-select]').click();
  await expect(collectionTab).toHaveAttribute('data-tab-active', 'true');

  const preRestartQuantitySort = page.locator('[data-sort-column="quantity"]');
  await expect(preRestartQuantitySort).toBeVisible();
  await preRestartQuantitySort.click();
  await expect(preRestartQuantitySort).toHaveAttribute('aria-label', /sorted ascending, priority 1/);

  await dragWorkspaceTabBefore(page, collectionTabId, queryTabId);
  await expect.poll(async () => {
    const ids = await page.locator('[data-tab-id]').evaluateAll((elements) => (
      elements.map((element) => element.getAttribute('data-tab-id'))
    ));
    return ids.indexOf(collectionTabId) < ids.indexOf(queryTabId);
  }).toBe(true);

  await collectionTab.dblclick();
  await page.getByLabel('Tab name').fill('Inventory work');
  await page.getByLabel('Tab name').press('Enter');
  await expect(collectionTab).toHaveAttribute('title', /^collection: Inventory work/);

  await queryTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename Tab…' }).click();
  await page.getByLabel('Tab name').fill('Pinned query');
  await page.getByLabel('Tab name').press('Enter');
  await expect(queryTab).toHaveAttribute('title', /^query: Pinned query/);

  await page.locator('[data-tab-kind="settings"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Rename Tab…' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Pin Tab' })).toBeVisible();
  await page.keyboard.press('Escape');

  await queryTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin Tab' }).click();
  await expect(queryTab).toHaveAttribute('data-tab-pinned', 'true');
  const pinIcon = queryTab.getByRole('img', { name: 'Pinned tab', exact: true });
  await expect(pinIcon).toBeVisible();
  await expect(pinIcon).toHaveAttribute('data-testid', 'tab-pin-icon');
  await expect(pinIcon).not.toContainText('📍');
  await expect(page.getByTestId('pinned-tab-divider')).toBeVisible();
  await expect(page.locator('[data-tab-id]').first()).toHaveAttribute('data-tab-id', queryTabId);

  await queryTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unpin Tab' }).click();
  await expect(queryTab).toHaveAttribute('data-tab-pinned', 'false');
  await expect(queryTab.getByTestId('tab-pin-icon')).toHaveCount(0);
  await queryTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin Tab' }).click();
  await expect(queryTab.getByRole('img', { name: 'Pinned tab', exact: true })).toBeVisible();
  await queryTab.click();
  await expectWorkspaceSurfaceFullWidth(page, 'query-editor');

  await page.getByTestId('save-query').click();
  let saveDialog = page.getByRole('dialog', { name: 'Save item' });
  await saveDialog.getByLabel('Saved item name').fill('E2E Saved Query');
  for (const folderName of ['Level 1', 'Level 2', 'Level 3']) {
    await saveDialog.getByRole('button', { name: '+ Folder' }).click();
    await saveDialog.getByLabel('New saved folder name').fill(folderName);
    await saveDialog.getByRole('button', { name: 'Create', exact: true }).click();
  }
  await saveDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved · E2E Saved Query')).toBeVisible();

  await page.getByRole('button', { name: 'More save options' }).click();
  await page.getByRole('menuitem', { name: 'Save Tab…' }).click();
  saveDialog = page.getByRole('dialog', { name: 'Save item' });
  await saveDialog.getByLabel('Saved item name').fill('E2E Saved Tab');
  await saveDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved · E2E Saved Tab')).toBeVisible();

  const profileBeforeRestart = explorer.getByRole('treeitem', { name: 'Connection E2E Local' });
  await profileBeforeRestart.focus();
  await page.keyboard.press('ArrowRight');
  const savedRootBeforeRestart = explorer.getByRole('treeitem', { name: 'Saved for E2E Local' });
  await expect(savedRootBeforeRestart).toBeVisible();
  await expect(savedRootBeforeRestart).toHaveAttribute('aria-expanded', 'true');
  await expect(explorer.getByRole('treeitem', { name: 'Saved folder Level 1' })).toBeVisible();
  await expect(explorer.locator('[data-saved-item-type="query"]')).toHaveCount(1);
  await expect(explorer.locator('[data-saved-item-type="tab"]')).toHaveCount(1);

  await dragHorizontalSeparator(page, page.getByTestId('sidebar-resizer'), 80);
  await expect(page.getByTestId('connection-explorer')).toHaveJSProperty('clientWidth', 340);
  await expectViewportLocked(page);

  await closeApplication();
  page = await launch();
  await expect(page.getByText('Welcome back')).toBeVisible();
  await expect(page.getByTestId('connection-explorer')).toHaveJSProperty('clientWidth', 340);
  await expect(page.locator('[title^="welcome: Welcome"]')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('[data-tab-kind="settings"]').click();
  await expect(page.getByRole('radio', { name: 'MongoDB Shell data display' }))
    .toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-tab-id]').first()).toHaveAttribute('data-tab-id', queryTabId);
  await expect(page.locator(`[data-tab-id="${queryTabId}"]`)).toHaveAttribute('data-tab-pinned', 'true');
  await expect(page.locator(`[data-tab-id="${queryTabId}"]`)).toHaveAttribute('title', /^query: Pinned query/);
  await expect(page.locator(`[data-tab-id="${collectionTabId}"]`)).toHaveAttribute('title', /^collection: Inventory work/);
  await expect(page.locator(`[data-collection-surface="${collectionTabId}"]`)).toHaveCount(0);
  explorer = page.getByRole('navigation', { name: 'Connection explorer' });
  await expect(explorer.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await expect(
    explorer.getByRole('treeitem', { name: 'Group E2E Renamed Group' }).locator('..')
      .getByRole('treeitem', { name: 'Connection E2E Local' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Open global search' }).click();
  const savedQuickOpen = page.getByLabel('Search databases and collections');
  await savedQuickOpen.fill('E2E Saved Query');
  await page.getByRole('option', { name: /E2E Saved Query/ }).click();
  await expect(page.getByTestId('query-editor').getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await expect(page.getByText('Saved · E2E Saved Query')).toBeVisible();

  await explorer.getByRole('button', { name: 'Connection settings for E2E Local' }).click();
  await page.getByRole('complementary').getByText('E2E Local', { exact: true }).click();
  await page.getByLabel('Connection name').fill('E2E Renamed');
  await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
  await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('E2E Renamed', { exact: true }).first()).toBeVisible();
  await expect(explorer.getByRole('button', { name: 'Connection settings for E2E Renamed' })).toBeVisible();
  await explorer.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(explorer.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await explorer.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(explorer.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Open global search' }).click();
  const quickOpen = page.getByLabel('Search databases and collections');
  await expect(quickOpen).toBeVisible();
  await quickOpen.fill('inventory');
  await expect(page.getByRole('option', { name: /inventory/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('option', { name: /inventory/ }).click();
  await expect(page.getByRole('button', { name: 'Documents', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-sort-column="quantity"]'))
    .toHaveAttribute('aria-label', /sorted ascending, priority 1/);

  const profileTreeItem = explorer.getByRole('treeitem', { name: 'Connection E2E Renamed' });
  await profileTreeItem.focus();
  await page.keyboard.press('ArrowRight');
  await expect(profileTreeItem).toBeFocused();
  const databaseTreeItem = explorer.getByRole('treeitem', { name: 'Database mongog_e2e' });
  await expect(databaseTreeItem).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(explorer.locator('[role="treeitem"][aria-level="3"]:focus')).toBeVisible();
  for (let index = 0; index < 20 && !(await databaseTreeItem.evaluate((element) => element === document.activeElement)); index += 1) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(databaseTreeItem).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(databaseTreeItem).not.toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(databaseTreeItem).toBeFocused();
  await databaseTreeItem.press('ArrowRight');
  await expect(databaseTreeItem).toBeFocused();
  const collectionTreeItem = explorer.getByRole('treeitem', { name: 'Collection mongog_e2e.inventory' });
  await expect(collectionTreeItem).toBeVisible();
  await databaseTreeItem.press('ArrowRight');
  const focusedCollectionTreeItem = explorer.locator('[role="treeitem"][aria-level="4"]:focus');
  await expect(focusedCollectionTreeItem).toBeVisible();
  await focusedCollectionTreeItem.press('ArrowLeft');
  await expect(databaseTreeItem).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(collectionTreeItem).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(collectionTreeItem).toBeVisible();
  await explorer.getByLabel('Search connections').fill('inventory');
  await expect(page.getByTitle('Open mongog_e2e.inventory')).toBeVisible();
  await explorer.getByLabel('Search connections').fill('');

  await page.getByTitle('Open mongog_e2e.inventory').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Indexes' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Indexes' }).click();
  await expect(page.locator('[title^="admin: Indexes · mongog_e2e.inventory"]')).toBeVisible();
  await expect(page.getByText('Indexes', { exact: true }).first()).toBeVisible();
  await page.getByTitle('Open mongog_e2e.inventory').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Watch Changes' }).click();
  const changeStreamTab = page.locator('[title^="change-stream: Changes · mongog_e2e.inventory"]');
  await expect(changeStreamTab).toBeVisible();
  await expect(page.getByRole('button', { name: 'Status field changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Start stream' }).click();
  await expect(page.getByRole('status', { name: 'Change stream live' })).toBeVisible();
  const liveDot = page.getByTestId('change-stream-live-dot');
  await expect(liveDot).toBeVisible();
  await expect.poll(() => liveDot.evaluate((element) => {
    const rootColor = getComputedStyle(document.documentElement).getPropertyValue('--color-danger').trim();
    const probe = document.createElement('span');
    probe.style.color = rootColor;
    document.body.appendChild(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(element).backgroundColor === expected;
  })).toBe(true);

  await page.getByTitle('Open mongog_e2e.inventory').click();
  await expect(page.locator('[data-change-stream-surface]')).toHaveCount(1);
  const eventClient = new MongoClient(mongoUri);
  await eventClient.connect();
  try {
    await eventClient.db('mongog_e2e').collection('inventory').updateOne(
      { sku: 'alpha' },
      { $set: { status: 'changed-while-hidden' } },
    );
  } finally {
    await eventClient.close();
  }
  await changeStreamTab.click();
  await expect(page.getByRole('status', { name: 'Change stream live' })).toBeVisible();
  await expect(page.getByText(/changed-while-hidden/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Stop stream' }).click();
  await expect(page.getByRole('status', { name: 'Change stream stopped' })).toBeVisible();

  await page.getByRole('button', { name: 'Open application settings' }).click();
  const alphabeticalColumnOrder = page.getByRole('radio', { name: 'Alphabetical table column order' });
  const documentColumnOrder = page.getByRole('radio', { name: 'Database document order table column order' });
  await expect(alphabeticalColumnOrder).toHaveAttribute('aria-checked', 'true');
  await documentColumnOrder.click();
  await expect(documentColumnOrder).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('audit-settings')).toBeVisible();
  await expect(page.getByLabel('Audit retention days')).toHaveValue('90');
  await expect(page.getByLabel('Maximum audit entries')).toHaveValue('50000');
  await page.getByRole('button', { name: 'Open Activity Log' }).click();
  await expect(page.getByTestId('activity-log-view')).toBeVisible();
  await expect(page.locator('[data-tab-kind="history"]')).toHaveCount(1);
  await page.locator('[data-tab-kind="history"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Rename Tab…' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Log table' }).click();
  await expect.poll(() => page.locator('[data-audit-entry]').count()).toBeGreaterThan(0);
  await page.getByLabel('Filter by action').fill('connection.connect');
  await expect(page.getByTestId('activity-log-table')).toContainText('connection.connect');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete filtered…' }).click();
  await expect(page.getByTestId('activity-log-table')).toContainText('No entries');
  await page.getByRole('button', { name: 'Reset' }).click();

  await page.getByTitle('Open mongog_e2e.inventory').click();
  await expect(page.getByRole('button', { name: 'Documents', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('"alpha"', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Collection filter')).toBeVisible();
  await expect(page.getByLabel('Collection sort')).toBeVisible();
  await expect(page.getByLabel('Collection projection')).toBeVisible();
  const criteriaActions = page.getByRole('group', { name: 'Criteria actions' });
  await expect(criteriaActions.getByRole('button')).toHaveText(['Clear', 'Apply', 'Refresh']);
  await expectViewportLocked(page);
  const documentsTable = page.getByTestId('collection-documents-table');
  await expect.poll(() => collectionColumnNames(page))
    .toEqual(['_id', 'sku', 'quantity', 'amenities', 'catalog']);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => collectionColumnNames(page))
    .toEqual(['_id', 'sku', 'quantity', 'amenities', 'catalog', 'status']);
  const firstDocumentRow = documentsTable.locator('tbody tr').first();
  const headerQuantitySort = page.locator('[data-sort-column="quantity"]');
  const headerSkuSort = page.locator('[data-sort-column="sku"]');
  await expect(headerQuantitySort).toHaveAttribute('aria-label', /sorted ascending, priority 1/);
  await headerSkuSort.click();
  await expect(headerSkuSort).toHaveAttribute('aria-label', /sorted ascending, priority 2/);
  await headerQuantitySort.click();
  await expect(headerQuantitySort).toHaveAttribute('aria-label', /sorted descending, priority 1/);
  await expect(firstDocumentRow).toContainText('"beta"');
  await headerQuantitySort.click();
  await expect(headerQuantitySort).toHaveAttribute('aria-label', 'Sort quantity ascending');
  await expect(headerSkuSort).toHaveAttribute('aria-label', /sorted ascending, priority 1/);
  await expect(firstDocumentRow).toContainText('"alpha"');
  await headerSkuSort.click();
  await expect(headerSkuSort).toHaveAttribute('aria-label', /sorted descending, priority 1/);
  await expect(firstDocumentRow).toContainText('"beta"');
  await headerSkuSort.click();
  await expect(headerSkuSort).toHaveAttribute('aria-label', 'Sort sku ascending');
  await expect(firstDocumentRow).toContainText('"alpha"');

  const skuHeader = headerSkuSort.locator('xpath=ancestor::th');
  const quantityHeader = headerQuantitySort.locator('xpath=ancestor::th');
  const skuDragHandle = page.locator('[data-column-drag-handle="sku"]');
  await expect(skuHeader).not.toHaveAttribute('draggable', 'true');
  await expect(skuDragHandle).toHaveAttribute('draggable', 'true');
  await page.mouse.move(1, 1);
  await expect(skuDragHandle).toHaveCSS('opacity', '0');
  await skuHeader.hover();
  await expect(skuDragHandle).toHaveCSS('opacity', '0.6');
  await skuDragHandle.dragTo(quantityHeader);
  await expect.poll(() => collectionColumnNames(page))
    .toEqual(['_id', 'quantity', 'sku', 'amenities', 'catalog', 'status']);
  await expect(headerSkuSort).toHaveAttribute('aria-label', 'Sort sku ascending');
  await expect(headerQuantitySort).toHaveAttribute('aria-label', 'Sort quantity ascending');
  const skuFilter = page.getByLabel('Filter sku column');
  await skuFilter.fill('alpha');
  await expect(skuFilter).toBeFocused();
  await expect.poll(() => collectionColumnNames(page))
    .toEqual(['_id', 'quantity', 'sku', 'amenities', 'catalog', 'status']);
  await skuFilter.fill('');

  await page.locator('[data-tab-kind="settings"]').click();
  await alphabeticalColumnOrder.click();
  await expect(alphabeticalColumnOrder).toHaveAttribute('aria-checked', 'true');
  await page.locator(`[data-tab-id="${collectionTabId}"]`).click();
  await expect.poll(() => collectionColumnNames(page))
    .toEqual(['_id', 'quantity', 'sku', 'amenities', 'catalog', 'status']);
  await page.locator('[data-tab-kind="settings"]').click();
  await expect(documentColumnOrder).toBeEnabled();
  await documentColumnOrder.click();
  await expect(documentColumnOrder).toHaveAttribute('aria-checked', 'true');
  await page.locator(`[data-tab-id="${collectionTabId}"]`).click();

  await page.getByRole('button', { name: 'Show column filter syntax' }).click();
  await expect(page.getByRole('note')).toContainText('100..200');
  await expect(page.getByRole('note')).toContainText('len = 3');
  await page.getByRole('button', { name: 'More examples' }).click();
  await expect(page.getByTestId('column-filter-examples')).toContainText('{address}{street1}: *Monte Vista*');
  await expect(page.getByTestId('column-filter-examples')).toContainText('{geo}{coordinates}: has -121.96328');
  await expect(page.getByTestId('column-filter-examples')).toContainText('{nickname}: ""');
  await expect(page.getByTestId('column-filter-examples')).toContainText('has ""');
  await expect(page.getByTestId('column-filter-examples')).toContainText('[{name}]: *Com*');
  await expect(page.getByTestId('column-filter-examples')).toContainText('[{items}][{sku}]: A-42');
  await page.getByRole('button', { name: 'Show column filter syntax' }).click();

  const quickQuantityFilter = page.getByLabel('Filter quantity column');
  const amenitiesFilter = page.getByLabel('Filter amenities column');
  const catalogFilter = page.getByLabel('Filter catalog column');
  const quantityWidthBeforeEmptyFilter = await quantityHeader.evaluate(
    (element) => Math.round(element.getBoundingClientRect().width),
  );
  await quickQuantityFilter.fill('> 999');
  await quickQuantityFilter.press('Enter');
  await expect(documentsTable).toBeVisible();
  await expect(documentsTable.getByText('No documents found', { exact: true })).toBeVisible();
  await expect(quickQuantityFilter).toHaveValue('> 999');
  await expect(page.getByLabel('Filter sku column')).toBeVisible();
  await expect.poll(() => quantityHeader.evaluate(
    (element) => Math.round(element.getBoundingClientRect().width),
  )).toBe(quantityWidthBeforeEmptyFilter);
  await quickQuantityFilter.fill('');
  await quickQuantityFilter.press('Enter');
  await expect(page.getByText('"alpha"', { exact: true })).toBeVisible();

  await catalogFilter.fill('{city}: ""');
  await catalogFilter.press('Enter');
  await expect(page.getByText('"beta"', { exact: true })).toBeVisible();
  await expect(page.getByText('"alpha"', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('criteria-editor-filter')).toContainText('catalog.city');
  await expect(page.getByTestId('criteria-editor-filter')).toContainText('""');
  await catalogFilter.fill('{products}[{name}]: *Com* AND {products}[{price}]: < 200');
  await catalogFilter.press('Enter');
  await expect(page.getByText('"alpha"', { exact: true })).toBeVisible();
  await expect(page.getByText('"beta"', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('criteria-editor-filter')).toContainText('$elemMatch');
  await catalogFilter.fill('{products}[{tags}]: len >= 1');
  await catalogFilter.press('Enter');
  await expect(page.getByText('"alpha"', { exact: true })).toBeVisible();
  await expect(page.getByText('"beta"', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('criteria-editor-filter')).toContainText('$anyElementTrue');
  await catalogFilter.fill('{bad.name}: value');
  await expect(catalogFilter).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await catalogFilter.fill('');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const nestedCleanupClient = new MongoClient(mongoUri);
  await nestedCleanupClient.connect();
  try {
    await nestedCleanupClient.db('mongog_e2e').collection('inventory').updateMany(
      {},
      { $unset: { catalog: '' } },
    );
  } finally {
    await nestedCleanupClient.close();
  }
  await amenitiesFilter.fill('len = 2');
  await amenitiesFilter.press('Enter');
  await expect(page.getByText('"alpha"', { exact: true })).toBeVisible();
  await expect(page.getByText('"beta"', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('criteria-editor-filter')).toContainText('$size');
  await amenitiesFilter.fill('len = 1 OR has "*if*"');
  await amenitiesFilter.press('Enter');
  await expect(page.getByText('"alpha"', { exact: true })).toBeVisible();
  await expect(page.getByText('"beta"', { exact: true })).toBeVisible();
  await amenitiesFilter.fill('len 3..1');
  await expect(amenitiesFilter).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await amenitiesFilter.fill('');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await quickQuantityFilter.fill('3..7');
  await quickQuantityFilter.press('Enter');
  await expect(page.getByText('"alpha"', { exact: true })).toBeVisible();
  await expect(page.getByText('"beta"', { exact: true })).toBeVisible();
  await amenitiesFilter.fill('has "*if*" OR has "*oo*"');
  await amenitiesFilter.press('Enter');
  await expect(page.getByText('"alpha"', { exact: true })).toBeVisible();
  await expect(page.getByText('"beta"', { exact: true })).toBeVisible();
  await amenitiesFilter.fill('has "*i*" AND !has "*oo*"');
  await amenitiesFilter.press('Enter');
  await expect(page.getByText('"alpha"', { exact: true })).toBeVisible();
  await expect(page.getByText('"beta"', { exact: true })).toHaveCount(0);
  await quickQuantityFilter.fill('7..3');
  await expect(quickQuantityFilter).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await quickQuantityFilter.fill('');
  await amenitiesFilter.fill('');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('"beta"', { exact: true })).toBeVisible();

  // Keep enough vertical room for the drag assertion on smaller CI displays.
  // The Criteria surface has its own growable Monaco editors and deliberately
  // takes precedence over the document panel's maximum height.
  const criteriaToggle = page.locator(`button[aria-controls="criteria-${collectionTabId}"]`);
  await expect(criteriaToggle).toHaveAttribute('aria-expanded', 'true');
  await criteriaToggle.click();
  await expect(criteriaToggle).toHaveAttribute('aria-expanded', 'false');

  const alphaDocumentRow = documentsTable.locator('tbody tr').filter({ hasText: '"alpha"' }).first();
  await alphaDocumentRow.click();
  const documentPanel = page.getByTestId('document-panel');
  const documentPanelResizer = page.getByRole('separator', { name: 'Resize document panel' });
  await expect(documentPanel).toBeVisible();
  await expect(documentPanelResizer).toHaveAttribute('aria-orientation', 'horizontal');
  const initialDocumentPanelHeight = await documentPanel.evaluate((element) => element.getBoundingClientRect().height);
  await dragVerticalSeparator(page, documentPanelResizer, -90);
  await expect.poll(() => documentPanel.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(initialDocumentPanelHeight + 50);
  const expandedDocumentPanelHeight = await documentPanel.evaluate((element) => element.getBoundingClientRect().height);

  await documentPanel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(documentPanel).toHaveCount(0);
  await alphaDocumentRow.click();
  await expect.poll(() => documentPanel.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(expandedDocumentPanelHeight - 2);
  await documentPanel.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(documentPanel.getByText('Edit document', { exact: true })).toBeVisible();
  await expect(documentPanelResizer).toBeVisible();
  await documentPanel.getByRole('button', { name: 'Cancel', exact: true }).click();

  await documentPanelResizer.dblclick();
  await expect.poll(() => documentPanel.evaluate((element) => element.getBoundingClientRect().height))
    .toBeLessThan(expandedDocumentPanelHeight - 40);
  await documentPanel.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(documentPanel.getByText('New document', { exact: true })).toBeVisible();
  const initialNewPanelHeight = await documentPanel.evaluate((element) => element.getBoundingClientRect().height);
  await dragVerticalSeparator(page, documentPanelResizer, 80);
  await expect.poll(() => documentPanel.evaluate((element) => element.getBoundingClientRect().height))
    .toBeLessThan(initialNewPanelHeight - 40);
  await expect.poll(() => documentsTable.evaluate((element) => element.parentElement!.getBoundingClientRect().height))
    .toBeGreaterThanOrEqual(119);
  await expect(documentPanel.locator('.monaco-editor')).toBeVisible();
  await expectViewportLocked(page);
  await documentPanel.getByRole('button', { name: 'Cancel', exact: true }).click();

  await criteriaToggle.click();
  await expect(criteriaToggle).toHaveAttribute('aria-expanded', 'true');
  const initialFilterHeight = await page.getByTestId('criteria-editor-filter').evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await setMonacoValue(page, 'Collection filter', '{ ');
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.suggest-widget.visible')).toContainText('sku', { timeout: 15_000 });
  await page.keyboard.press('Escape');
  // Monaco auto-closes the leading brace, matching normal user typing.
  await setMonacoValue(page, 'Collection filter', "{\n  sku: 'alpha',\n");
  await expect.poll(() => page.getByTestId('criteria-editor-filter').evaluate(
    (element) => element.getBoundingClientRect().height,
  )).toBeGreaterThan(initialFilterHeight);
  await expectViewportLocked(page);
  await setMonacoValue(page, 'Collection sort', '{ isSent: -1 }');
  await expect(page.locator('[data-sort-column="isSent"]')).toHaveCount(0);
  await setMonacoValue(page, 'Collection projection', '{ sku: 1, quantity: 1 }');
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('"alpha"', { exact: true })).toBeVisible();
  await expect(page.getByText('"beta"', { exact: true })).toHaveCount(0);
  const isSentSort = page.locator('[data-sort-column="isSent"]');
  await expect(isSentSort).toHaveAttribute('aria-label', /sorted descending, priority 1/);
  const isSentCellIndex = await isSentSort.evaluate((element) =>
    (element.closest('th') as HTMLTableCellElement).cellIndex);
  await expect(documentsTable.locator('tbody tr').first().locator('td').nth(isSentCellIndex))
    .toHaveText('null');
  await page.getByRole('button', { name: 'Calculate total document count' }).click();
  await expect(page.getByRole('button', { name: 'Calculate total document count' }))
    .toHaveText('Total count: 1');

  const quantityColumn = page.getByLabel('Filter quantity column');
  await quantityColumn.fill('> 4');
  await expect(page.getByRole('button', { name: /^Criteria.*edited/ })).toBeVisible();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('"beta"', { exact: true })).toBeVisible();

  await redirectSaveDialogs(application!, userDataPath);
  await page.getByRole('button', { name: 'Export…', exact: true }).click();
  const documentsExportDialog = page.getByRole('dialog', { name: 'Export mongog_e2e.inventory' });
  await expect(documentsExportDialog.getByRole('radio', { name: /Current page/ })).toBeChecked();
  await documentsExportDialog.getByRole('button', { name: /CSV/ }).click();
  await documentsExportDialog.getByRole('radio', { name: /All matching documents/ }).check();
  await documentsExportDialog.getByRole('button', { name: 'Continue…' }).click();
  await expect(page.getByText(/mongog_e2e_inventory_.*\.csv/).first()).toBeVisible();
  await expect.poll(async () => (await readdir(userDataPath)).some((file) => (
    /^mongog_e2e_inventory_.*\.csv$/u.test(file)
  ))).toBe(true);
  const documentsCsvName = (await readdir(userDataPath)).find((file) => /^mongog_e2e_inventory_.*\.csv$/u.test(file))!;
  const documentsCsv = await readFile(join(userDataPath, documentsCsvName), 'utf8');
  expect(documentsCsv).toContain('beta');
  expect(documentsCsv).not.toContain('alpha');
  await expect(page.getByTestId('collection-documents-table').locator('[data-bson-syntax]').first()).toBeVisible();
  await expect(page.getByTestId('collection-documents-table').locator('[data-bson-token="string"]').first()).toBeVisible();
  await expect(page.getByText('"alpha"', { exact: true })).toHaveCount(0);
  const initialQuantityWidth = await quantityColumn.evaluate((element) => element.closest('th')!.getBoundingClientRect().width);
  const quantityResizer = page.getByRole('separator', { name: 'Resize quantity column' });
  const resizeBox = await quantityResizer.boundingBox();
  if (!resizeBox) throw new Error('Quantity column resize handle is missing');
  const resizeStart = { x: resizeBox.x + resizeBox.width / 2, y: resizeBox.y + 4 };
  await quantityResizer.dispatchEvent('pointerdown', {
    clientX: resizeStart.x,
    clientY: resizeStart.y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    bubbles: true,
  });
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: x + 90, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', {
      clientX: x + 90, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true,
    }));
  }, resizeStart);
  await expect.poll(() => quantityColumn.evaluate((element) => element.closest('th')!.getBoundingClientRect().width))
    .toBeGreaterThan(initialQuantityWidth + 50);
  await page.getByRole('button', { name: /^Criteria/ }).click();
  await expect(page.getByLabel('Collection filter')).toHaveCount(0);
  await page.getByRole('button', { name: /^Criteria/ }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('"beta"', { exact: true })).toBeVisible();

  await page.getByTestId('save-documents').click();
  saveDialog = page.getByRole('dialog', { name: 'Save item' });
  await saveDialog.getByLabel('Saved item name').fill('High quantity inventory');
  await saveDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved · High quantity inventory')).toBeVisible();
  await setMonacoValue(page, 'Collection sort', '{ quantity: -1 }');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('[data-sort-column="isSent"]')).toHaveCount(0);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await expect(page.getByText('Saved · High quantity inventory')).toBeVisible();

  const savedRoot = explorer.getByRole('treeitem', { name: 'Saved for E2E Renamed' });
  await expect(savedRoot).toHaveAttribute('aria-expanded', 'true');
  const savedDocumentNode = explorer.getByRole('treeitem', { name: 'Saved Document View High quantity inventory' });
  await expect(savedDocumentNode).toBeVisible();
  await savedDocumentNode.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit Details…' }).click();
  const editSavedDialog = page.getByRole('dialog', { name: 'Edit Saved Item' });
  await editSavedDialog.getByLabel('Saved item name').fill('High quantity inventory v2');
  await editSavedDialog.getByRole('button', { name: 'Save Changes' }).click();
  const renamedSavedDocument = explorer.getByRole('treeitem', { name: 'Saved Document View High quantity inventory v2' });
  await expect(renamedSavedDocument).toBeVisible();

  await page.getByTitle('Close High quantity inventory v2').click();
  await renamedSavedDocument.click();
  const reopenedCollectionTab = page.locator(
    '[data-tab-kind="collection"][title^="collection: High quantity inventory v2"]',
  );
  collectionTabId = await reopenedCollectionTab.getAttribute('data-tab-id');
  if (!collectionTabId) throw new Error('Expected reopened collection tab id');
  await expect(page.getByText('"beta"', { exact: true })).toBeVisible();
  await expect(page.getByText('"alpha"', { exact: true })).toHaveCount(0);
  await expect.poll(() => collectionColumnNames(page)).toEqual(['_id', 'sku', 'quantity']);

  await expect(explorer.locator('[data-saved-item-type="documents"] svg')).toBeVisible();
  await expect(explorer.locator('[data-saved-item-type="tab"] svg')).toBeVisible();
  const levelOneFolder = explorer.getByRole('treeitem', { name: 'Saved folder Level 1' });
  await levelOneFolder.click();
  const levelTwoFolder = explorer.getByRole('treeitem', { name: 'Saved folder Level 2' });
  await levelTwoFolder.click();
  await explorer.getByRole('treeitem', { name: 'Saved folder Level 3' }).click();
  await expect(explorer.locator('[data-saved-item-type="query"] svg')).toBeVisible();

  await page.getByRole('button', { name: 'Query', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Query', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('query-results-region')).toHaveCount(0);
  await expectWorkspaceSurfaceFullWidth(page, 'query-editor');
  await expectQueryEditorFullHeight(page);
  await expect(page.getByLabel('Connection', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Database', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Run/ }).click();
  await expect(page.getByTestId('query-results-region')).toBeVisible();
  await expect(page.getByText('Statement 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('documents', { exact: true })).toBeVisible();
  await expectQueryColumnsFillWidth(page);
  const initialResultsHeight = await page.getByTestId('query-results-region').evaluate((element) => element.getBoundingClientRect().height);
  const resultsResizer = page.getByTestId('query-results-resizer');
  await dragVerticalSeparator(page, resultsResizer, -80);
  await expect.poll(() => page.getByTestId('query-results-region').evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(initialResultsHeight + 50);
  const statement = page.getByRole('button', { name: /Statement 1.*documents/ });
  await statement.click();
  await expect(page.getByTestId('query-documents-table')).toHaveCount(0);
  await statement.click();
  await expect(page.getByTestId('query-documents-table')).toBeVisible();
  await expect.poll(() => queryColumnNames(page))
    .toEqual(['#', '_id', 'sku', 'quantity', 'amenities', 'status']);
  await expect(page.getByTestId('query-documents-table').locator('[data-bson-syntax]').first()).toBeVisible();
  await expect(page.getByTestId('query-documents-table').locator('[data-bson-token="string"]').first()).toBeVisible();

  await page.locator('[data-tab-kind="settings"]').click();
  await alphabeticalColumnOrder.click();
  await expect(alphabeticalColumnOrder).toHaveAttribute('aria-checked', 'true');
  await page.locator(`[data-tab-id="${collectionTabId}"]`).click();
  await expect.poll(() => queryColumnNames(page))
    .toEqual(['#', '_id', 'amenities', 'quantity', 'sku', 'status']);
  await page.locator('[data-tab-kind="settings"]').click();
  await expect(documentColumnOrder).toBeEnabled();
  await documentColumnOrder.click();
  await expect(documentColumnOrder).toHaveAttribute('aria-checked', 'true');
  await page.locator(`[data-tab-id="${collectionTabId}"]`).click();
  await expect.poll(() => queryColumnNames(page))
    .toEqual(['#', '_id', 'sku', 'quantity', 'amenities', 'status']);

  await page.getByRole('button', { name: 'Export…', exact: true }).click();
  const queryExportDialog = page.getByRole('dialog', { name: 'Export Statement 1' });
  await queryExportDialog.getByRole('button', { name: /Text/ }).click();
  await queryExportDialog.getByRole('button', { name: 'Continue…' }).click();
  await expect.poll(async () => (await readdir(userDataPath)).some((file) => (
    /^mongog_e2e_inventory_.*\.txt$/u.test(file)
  ))).toBe(true);
  const queryTxtName = (await readdir(userDataPath)).find((file) => /^mongog_e2e_inventory_.*\.txt$/u.test(file))!;
  const queryTxt = await readFile(join(userDataPath, queryTxtName), 'utf8');
  expect(queryTxt).toContain('sku');
  expect(queryTxt).toContain('beta');

  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Criteria · 3/ })).toBeVisible();
  await expect(page.getByText('"beta"', { exact: true })).toBeVisible();

  const finalCollectionTab = page.locator(`[data-tab-id="${collectionTabId}"]`);
  await finalCollectionTab.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Close Tabs to the Left' })).toBeVisible();
  await page.keyboard.press('Escape');

  await finalCollectionTab.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Close All Tabs' }).click();
  await expect(page.locator('[data-tab-id]')).toHaveCount(1);
  await expect(page.locator(`[data-tab-id="${queryTabId}"]`)).toBeVisible();

  await explorer.getByRole('button', { name: 'Connection settings for E2E Renamed' }).click();
  await expect(page.locator('[title^="connection-settings: Connections"]')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No matching connections.')).toBeVisible();
  const unassignedSaved = explorer.getByRole('treeitem', { name: 'Unassigned Saved for Unassigned' });
  await expect(unassignedSaved).toBeVisible();
  await unassignedSaved.click();
  const unassignedLevelOne = explorer.getByRole('treeitem', { name: 'Saved folder Level 1' });
  await unassignedLevelOne.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const deleteSavedFolderDialog = page.getByRole('dialog', { name: 'Delete saved folder' });
  await expect(deleteSavedFolderDialog).toContainText('3 folder(s) and 1 saved item(s)');
  await deleteSavedFolderDialog.getByRole('textbox').fill('Level 1');
  await deleteSavedFolderDialog.getByRole('textbox').press('Enter');
  await expect(unassignedLevelOne).toHaveCount(0);

  const unassignedTabItem = explorer.getByRole('treeitem', { name: 'Saved Tab Template E2E Saved Tab' });
  await unassignedTabItem.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const deleteSavedItemDialog = page.getByRole('dialog', { name: 'Delete saved item' });
  await deleteSavedItemDialog.getByRole('textbox').fill('E2E Saved Tab');
  await deleteSavedItemDialog.getByRole('textbox').press('Enter');
  await expect(unassignedTabItem).toHaveCount(0);
  await expect(page.locator(`[data-tab-id="${queryTabId}"]`)).toBeVisible();
  const renamedGroupNode = explorer.getByRole('treeitem', { name: 'Group E2E Renamed Group' });
  await renamedGroupNode.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete Group…' }).click();
  const deleteGroupDialog = page.getByRole('dialog', { name: 'Delete group' });
  await deleteGroupDialog.getByRole('textbox').fill('E2E Renamed Group');
  await deleteGroupDialog.getByRole('textbox').press('Enter');
  await expect(renamedGroupNode).toHaveCount(0);
  const activeBeforeClosingPinnedQuery = await page.locator('[data-tab-active="true"]').getAttribute('data-tab-id');
  if (!activeBeforeClosingPinnedQuery) throw new Error('Expected an active tab before closing the pinned query');
  expect(activeBeforeClosingPinnedQuery).not.toBe(queryTabId);
  const closePinnedQuery = page.getByTitle('Close Pinned query');
  await closePinnedQuery.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-tab-id="${queryTabId}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-tab-id="${activeBeforeClosingPinnedQuery}"]`)).toHaveAttribute('data-tab-active', 'true');
  await page.getByRole('button', { name: 'Open Welcome' }).click();
  await page.getByRole('button', { name: 'What’s New in 1.2.12' }).click();
  await expect(page.locator('[data-tab-kind="release-notes"]')).toHaveCount(1);
});

test('global collection defaults persist and auto-run a new Query collection once', async () => {
  let page = await launch();
  await expect(page.locator('[data-tab-kind="welcome"]')).toHaveAttribute('data-tab-active', 'true');
  const releaseNotesTab = page.locator('[data-tab-kind="release-notes"]');
  // Keep this persistence test independent from the preceding lifecycle test:
  // if that test is interrupted before its final save, establish the same
  // starting workspace explicitly instead of reporting a cascading failure.
  if (await releaseNotesTab.count() === 0) {
    await page.getByRole('button', { name: 'What’s New in 1.2.12' }).click();
    await expect(releaseNotesTab).toHaveCount(1);
    await page.getByRole('button', { name: 'Open Welcome' }).click();
  }
  await expect(releaseNotesTab).toHaveAttribute('data-tab-active', 'false');
  await page.getByRole('button', { name: 'Open application settings' }).click();
  await expect(page.getByTestId('collection-defaults-settings')).toBeVisible();
  const documentColumnOrder = page.getByRole('radio', {
    name: 'Database document order table column order',
  });
  if (await documentColumnOrder.getAttribute('aria-checked') !== 'true') {
    await documentColumnOrder.click();
  }
  await expect(documentColumnOrder).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Preferences are saved automatically.')).toBeVisible();

  const queryDefault = page.getByRole('radio', { name: 'Query default collection view' });
  if (await queryDefault.getAttribute('aria-checked') !== 'true') await queryDefault.click();
  await expect(queryDefault).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Preferences are saved automatically.')).toBeVisible();

  const autoRun = page.getByRole('switch', { name: 'Run default collection query automatically' });
  if (await autoRun.getAttribute('aria-checked') !== 'true') await autoRun.click();
  await expect(autoRun).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Preferences are saved automatically.')).toBeVisible();

  const globalPageSize = page.getByLabel('Global page size');
  await globalPageSize.fill('100');
  await globalPageSize.press('Enter');
  await expect(globalPageSize).toHaveValue('100');
  await expect(page.getByText('Preferences are saved automatically.')).toBeVisible();

  const idleTimeout = page.getByLabel('Disconnect idle connections after');
  await expect(idleTimeout).toHaveValue('3600000');
  await idleTimeout.selectOption(String(2 * 60 * 60 * 1000));
  await expect(idleTimeout).toHaveValue('7200000');
  await expect(page.getByText('Preferences are saved automatically.')).toBeVisible();

  await closeApplication();
  page = await launch();
  await expect(page.locator('[data-tab-kind="welcome"]')).toHaveAttribute('data-tab-active', 'true');
  await expect(page.locator('[data-tab-kind="release-notes"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open application settings' }).click();
  await expect(page.getByRole('radio', { name: 'Database document order table column order' }))
    .toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Query default collection view' }))
    .toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch', { name: 'Run default collection query automatically' }))
    .toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Global page size')).toHaveValue('100');
  await expect(page.getByLabel('Disconnect idle connections after')).toHaveValue('7200000');

  await page.locator('[title^="welcome: Welcome"]').click();
  await page.getByRole('button', { name: 'New Connection', exact: true }).click();
  await page.getByLabel('Connection name').fill('Defaults E2E');
  await page.getByLabel('Connection URI').fill(mongoUri);
  await page.getByLabel('Default database').fill('mongog_e2e');
  await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
  await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Open global search' }).click();
  const search = page.getByLabel('Search databases and collections');
  await search.fill('inventory');
  const collectionResult = page.getByRole('option', { name: /inventory Defaults E2E/ });
  await expect(collectionResult).toBeVisible({ timeout: 15_000 });
  await collectionResult.click();

  await expect(page.getByRole('button', { name: 'Query', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('query-editor-surface').locator('.view-lines'))
    .toContainText('limit(100)');
  await expect(page.getByTestId('query-results-region')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Statement 1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  const documentsPageSize = page.getByLabel('Documents page size');
  await expect(documentsPageSize).toHaveValue('default');
  await expect(documentsPageSize.locator('option:checked')).toHaveText('Default · 100');
  await documentsPageSize.selectOption('25');
  await expect(documentsPageSize).toHaveValue('25');
  await expect(page.getByText('Page 1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Query', exact: true }).click();
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(documentsPageSize).toHaveValue('25');

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(documentsPageSize).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(documentsPageSize).toBeEnabled();
  await documentsPageSize.selectOption('default');
  await expect(documentsPageSize).toHaveValue('default');

  await page.getByRole('button', { name: 'Query', exact: true }).click();
  const defaultsProfileId = await page.evaluate(async () => {
    const profile = (await window.mongog.connections.listProfiles())
      .find((candidate) => candidate.name === 'Defaults E2E');
    if (!profile) throw new Error('Defaults E2E profile was not found');
    return profile.id;
  });
  const runtimePidBeforeCancel = await page.evaluate(async (profileId) => (
    await window.mongog.connections.getState(profileId)
  ).pid, defaultsProfileId);
  const queryFailPointClient = new MongoClient(mongoUri);
  await queryFailPointClient.connect();
  await queryFailPointClient.db('admin').command({
    configureFailPoint: 'failCommand',
    mode: { times: 1 },
    data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 10_000 },
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('Execution mode').selectOption('trusted');
  await setQueryEditorValue(page, 'await db.collection("inventory").findOne({});');
  await page.getByRole('button', { name: /^Run/ }).click();
  const queryLoading = page.getByTestId('loading-overlay');
  await expect(queryLoading).toBeVisible();
  await expect(queryLoading).toHaveAttribute('aria-label', /query/i);
  await expectCancelBelowSpinner(queryLoading);
  await queryLoading.getByRole('button', { name: 'Cancel' }).click();
  await expect(queryLoading).toHaveCount(0);
  await expect(page.getByTestId('query-results-region').getByText('cancelled', { exact: true }).first())
    .toBeVisible();
  await expect.poll(async () => page.evaluate(async (profileId) => {
    const state = await window.mongog.connections.getState(profileId);
    return state.status === 'connected' ? state.pid : null;
  }, defaultsProfileId), { timeout: 15_000 }).not.toBe(runtimePidBeforeCancel);
  await queryFailPointClient.db('admin').command({
    configureFailPoint: 'failCommand',
    mode: 'off',
  }).catch(() => undefined);
  await queryFailPointClient.close();
  await setQueryEditorValue(page, 'await db.command({ ping: 1 });');
  await page.getByRole('button', { name: /^Run/ }).click();
  await expect(page.getByTestId('query-results-region').getByText('completed', { exact: true }).first())
    .toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  const failPointClient = new MongoClient(mongoUri);
  await failPointClient.connect();
  try {
    await failPointClient.db('admin').command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 10_000 },
    });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const documentsLoading = page.getByTestId('loading-overlay');
    await expect(documentsLoading).toHaveAttribute('aria-label', 'Loading documents…');
    await expectCancelBelowSpinner(documentsLoading);
    await documentsLoading.getByRole('button', { name: 'Cancel' }).click();
    await expect(documentsLoading).toHaveCount(0);
    await expect(page.getByText('"alpha"', { exact: true })).toBeVisible();
  } finally {
    await failPointClient.db('admin').command({
      configureFailPoint: 'failCommand',
      mode: 'off',
    }).catch(() => undefined);
    await failPointClient.close();
  }
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('"alpha"', { exact: true })).toBeVisible();

  const retainedCollectionTabId = await page
    .locator('[data-tab-kind="collection"][data-tab-active="true"]')
    .getAttribute('data-tab-id');
  if (!retainedCollectionTabId) throw new Error('Expected an active collection tab');
  const retainedCollectionTab = page.locator(`[data-tab-id="${retainedCollectionTabId}"]`);
  const retainedCollectionSurface = page.locator(
    `[data-collection-surface="${retainedCollectionTabId}"]`,
  );
  const lifecycleClient = new MongoClient(mongoUri);
  await lifecycleClient.connect();
  try {
    await page.locator('[data-tab-kind="settings"]').click();
    await lifecycleClient.db('mongog_e2e').collection('inventory').updateOne(
      { sku: 'alpha' },
      { $set: { tabSwitchProbe: 'visible-after-refresh' } },
    );
    await lifecycleClient.db('admin').command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 1_000 },
    });

    await retainedCollectionTab.click();
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expect(retainedCollectionSurface.getByTestId('loading-overlay')).toHaveCount(0);
    await expect(retainedCollectionSurface.getByText('"visible-after-refresh"', { exact: true }))
      .toHaveCount(0);

    await retainedCollectionSurface.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(retainedCollectionSurface.getByTestId('loading-overlay')).toBeVisible();
    await expect(retainedCollectionSurface.getByText('"visible-after-refresh"', { exact: true }))
      .toBeVisible({ timeout: 10_000 });

    await lifecycleClient.db('mongog_e2e').collection('inventory').updateOne(
      { sku: 'alpha' },
      { $set: { tabSwitchProbe: 'completed-while-hidden' } },
    );
    await lifecycleClient.db('admin').command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 1_000 },
    });
    await retainedCollectionSurface.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(retainedCollectionSurface.getByTestId('loading-overlay')).toBeVisible();
    await page.locator('[data-tab-kind="settings"]').click();
    await expect(retainedCollectionSurface.getByTestId('loading-overlay'))
      .toHaveCount(0, { timeout: 10_000 });
    await retainedCollectionTab.click();
    await expect(retainedCollectionSurface.getByText('"completed-while-hidden"', { exact: true }))
      .toBeVisible();

    await lifecycleClient.db('mongog_e2e').collection('inventory_secondary').insertOne({
      sku: 'secondary',
      quantity: 1,
    });
    const defaultsExplorer = page.getByRole('navigation', { name: 'Connection explorer' });
    const defaultsProfile = defaultsExplorer.getByRole('treeitem', { name: 'Connection Defaults E2E' });
    await defaultsProfile.focus();
    await defaultsProfile.press('ArrowRight');
    const defaultsDatabase = defaultsExplorer.getByRole('treeitem', { name: 'Database mongog_e2e' });
    await expect(defaultsDatabase).toBeVisible();
    await defaultsDatabase.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Refresh Collections' }).click();
    await defaultsDatabase.focus();
    await defaultsDatabase.press('ArrowRight');
    const secondaryCollection = page.getByTitle('Open mongog_e2e.inventory_secondary');
    await expect(secondaryCollection).toBeVisible();
    await secondaryCollection.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open Documents' }).click();
    const secondaryTab = page.locator('[data-tab-kind="collection"][data-tab-active="true"]');
    const secondaryTabId = await secondaryTab.getAttribute('data-tab-id');
    if (!secondaryTabId) throw new Error('Expected the secondary collection tab');
    const secondarySurface = page.locator(`[data-collection-surface="${secondaryTabId}"]`);
    await expect(secondarySurface.getByText('"secondary"', { exact: true })).toBeVisible();
    await secondarySurface.getByLabel('Documents page size').selectOption('25');
    await expect(secondarySurface.getByLabel('Documents page size')).toHaveValue('25');

    await retainedCollectionTab.click();
    await expect(retainedCollectionSurface.getByText('"completed-while-hidden"', { exact: true }))
      .toBeVisible();
    await expect(retainedCollectionSurface.getByLabel('Documents page size')).toHaveValue('default');
    await page.locator(`[data-tab-id="${secondaryTabId}"]`).click();
    await expect(secondarySurface.getByLabel('Documents page size')).toHaveValue('25');
    await page.getByTitle('Close mongog_e2e.inventory_secondary').click();
    await expect(page.locator(`[data-collection-surface="${secondaryTabId}"]`)).toHaveCount(0);
  } finally {
    await lifecycleClient.db('admin').command({
      configureFailPoint: 'failCommand',
      mode: 'off',
    }).catch(() => undefined);
    await lifecycleClient.db('mongog_e2e').collection('inventory').updateOne(
      { sku: 'alpha' },
      { $unset: { tabSwitchProbe: '' } },
    ).catch(() => undefined);
    await lifecycleClient.db('mongog_e2e').collection('inventory_secondary').drop()
      .catch(() => undefined);
    await lifecycleClient.close();
  }
});

test('Explorer collection opening preference creates independent tabs or reuses the first match', async () => {
  test.setTimeout(120_000);
  let page = await launch();
  await page.getByRole('button', { name: 'Open application settings' }).click();

  const documentsDefault = page.getByRole('radio', { name: 'Documents default collection view' });
  if (await documentsDefault.getAttribute('aria-checked') !== 'true') await documentsDefault.click();
  await expect(documentsDefault).toHaveAttribute('aria-checked', 'true');

  const reuseExisting = page.getByRole('radio', {
    name: 'Reuse existing tab for Explorer collections',
  });
  if (await reuseExisting.getAttribute('aria-checked') !== 'true') await reuseExisting.click();
  await expect(reuseExisting).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('button', { name: 'Open Welcome' }).click();
  await page.getByRole('button', { name: 'New Connection', exact: true }).click();
  await page.getByLabel('Connection name').fill('Explorer Tabs E2E');
  await page.getByLabel('Connection URI').fill(mongoUri);
  await page.getByLabel('Default database').fill('mongog_e2e');
  await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
  await expect(page.getByText('Connection tested, saved, and connected.'))
    .toBeVisible({ timeout: 30_000 });

  const explorer = page.getByRole('navigation', { name: 'Connection explorer' });
  const profile = explorer.getByRole('treeitem', { name: 'Connection Explorer Tabs E2E' });
  await profile.focus();
  await profile.press('ArrowRight');
  const database = explorer.getByRole('treeitem', { name: 'Database mongog_e2e' });
  await expect(database).toBeVisible({ timeout: 15_000 });
  await database.focus();
  await database.press('ArrowRight');
  const collection = page.getByTitle('Open mongog_e2e.inventory');
  await expect(collection).toBeVisible({ timeout: 15_000 });

  const collectionTabs = page.locator('[data-tab-kind="collection"]');
  const initialCollectionTabCount = await collectionTabs.count();
  await collection.click();
  await expect(collectionTabs).toHaveCount(initialCollectionTabCount + 1);
  const firstTabId = await page.locator('[data-tab-kind="collection"][data-tab-active="true"]')
    .getAttribute('data-tab-id');
  if (!firstTabId) throw new Error('Expected the first Explorer collection tab');

  await collection.click();
  await expect(collectionTabs).toHaveCount(initialCollectionTabCount + 1);
  await expect(page.locator(`[data-tab-id="${firstTabId}"]`)).toHaveAttribute('data-tab-active', 'true');

  await page.getByRole('button', { name: 'Open application settings' }).click();
  const alwaysNew = page.getByRole('radio', {
    name: 'Always open a new tab for Explorer collections',
  });
  await alwaysNew.click();
  await expect(alwaysNew).toHaveAttribute('aria-checked', 'true');

  await collection.click();
  await expect(collectionTabs).toHaveCount(initialCollectionTabCount + 2);
  const secondTabId = await page.locator('[data-tab-kind="collection"][data-tab-active="true"]')
    .getAttribute('data-tab-id');
  if (!secondTabId) throw new Error('Expected a second Explorer collection tab');
  await expect(page.locator(`[data-collection-surface="${secondTabId}"]`).getByText('"alpha"', { exact: true }))
    .toBeVisible({ timeout: 15_000 });

  await collection.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open Documents' }).click();
  await expect(collectionTabs).toHaveCount(initialCollectionTabCount + 3);
  const thirdTabId = await page.locator('[data-tab-kind="collection"][data-tab-active="true"]')
    .getAttribute('data-tab-id');
  if (!thirdTabId) throw new Error('Expected a third Explorer collection tab');
  const thirdSurface = page.locator(`[data-collection-surface="${thirdTabId}"]`);
  await expect(thirdSurface.getByText('"alpha"', { exact: true })).toBeVisible({ timeout: 15_000 });
  await thirdSurface.getByLabel('Documents page size').selectOption('25');
  await expect(thirdSurface.getByLabel('Documents page size')).toHaveValue('25');

  const secondTab = page.locator(`[data-tab-id="${secondTabId}"]`);
  const secondSurface = page.locator(`[data-collection-surface="${secondTabId}"]`);
  await secondTab.click();
  await expect(secondSurface.getByLabel('Documents page size')).toHaveValue('default');

  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    await client.db('mongog_e2e').collection('inventory').updateOne(
      { sku: 'alpha' },
      { $set: { explorerTabProbe: 'refresh-only' } },
    );
    await page.locator(`[data-tab-id="${thirdTabId}"]`).click();
    await expect(thirdSurface.getByText('"refresh-only"', { exact: true })).toHaveCount(0);
    await thirdSurface.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(thirdSurface.getByText('"refresh-only"', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Open application settings' }).click();
    await reuseExisting.click();
    await expect(reuseExisting).toHaveAttribute('aria-checked', 'true');
    await collection.click();
    await expect(collectionTabs).toHaveCount(initialCollectionTabCount + 3);
    await expect(page.locator(`[data-tab-id="${firstTabId}"]`))
      .toHaveAttribute('data-tab-active', 'true');

    await page.getByRole('button', { name: 'Open application settings' }).click();
    await alwaysNew.click();
    await expect(alwaysNew).toHaveAttribute('aria-checked', 'true');
    await closeApplication();
    page = await launch();
    await page.getByRole('button', { name: 'Open application settings' }).click();
    await expect(page.getByRole('radio', {
      name: 'Always open a new tab for Explorer collections',
    })).toHaveAttribute('aria-checked', 'true');
  } finally {
    await client.db('mongog_e2e').collection('inventory').updateOne(
      { sku: 'alpha' },
      { $unset: { explorerTabProbe: '' } },
    ).catch(() => undefined);
    await client.close();
  }
});

test('update available is surfaced in the sidebar after consent is declined', async () => {
  let page = await launch({ MONGOG_UPDATE_E2E_VERSION: '9.9.9' });
  // Decline the startup consent prompt; the update stays 'available' and the
  // sidebar badge + Updates tab remain reachable.
  page.once('dialog', (dialog) => dialog.dismiss());

  const updateButton = page.getByRole('button', { name: 'Update 9.9.9 available' });
  await expect(updateButton).toBeVisible();
  await expect(page.getByTitle(/MongoG version /)).toContainText('v1.2.12');

  await updateButton.click();
  await expect(page.getByTestId('updates-view')).toBeVisible();
  await expect(page.locator('[data-tab-kind="updates"]')).toHaveCount(1);
  await expect(page.getByText('A new version (v9.9.9) is available.', { exact: true })).toBeVisible();
  const downloadButton = page.getByRole('button', { name: 'Download now' });
  await expect(downloadButton).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remind me later' })).toBeVisible();
  await expect(page.getByText("What's new in v9.9.9", { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Remind me later' }).click();
  await expect(updateButton).toHaveCount(0);
});

test('update available can be installed from the Updates tab and reach the Restart & Install state', async () => {
  let page = await launch({ MONGOG_UPDATE_E2E_VERSION: '9.9.9' });
  // If the startup consent prompt appears before we attach this handler,
  // Playwright auto-dismisses it (declare intent explicitly for clarity): that
  // keeps the phase 'available' so we can drive the install manually below.
  page.once('dialog', (dialog) => dialog.dismiss());

  const sidebarBadge = page.getByRole('button', { name: 'Update 9.9.9 available' });
  await expect(sidebarBadge).toBeVisible();
  await sidebarBadge.click();
  await expect(page.getByTestId('updates-view')).toBeVisible();
  await expect(page.locator('[data-tab-kind="updates"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Download now' })).toBeVisible();
  await page.getByRole('button', { name: 'Download now' }).click();
  const restartButton = page.getByRole('button', { name: 'Restart & Install' });
  await expect(restartButton).toBeVisible();
  await expect(page.getByText('Download finished. Restart the app to install.', { exact: true }))
    .toBeVisible();
});

test('packaged updater downloads from a real generic feed only after consent', async () => {
  test.skip(process.platform === 'win32', 'Unsigned Windows packages intentionally use manual updates and have no updater config.');
  const cachePath = await mkdtemp(join(tmpdir(), 'mongog-update-cache-e2e-'));
  const feed = await startUpdateFeed('9.9.9');
  try {
    const page = await launch({
      MONGOG_UPDATE_FEED_URL: feed.url,
      MONGOG_UPDATE_E2E_VERSION: '',
    });
    page.once('dialog', (dialog) => dialog.dismiss());
    await isolateUpdateCache(application!, cachePath);

    await expect.poll(() => feed.requests).toContain(`/update/${feed.manifest}`);
    const badge = page.getByRole('button', { name: 'Update 9.9.9 available' });
    await expect(badge).toBeVisible();
    await badge.click();
    await expect(page.getByRole('button', { name: 'Download now' })).toBeVisible();
    expect(feed.requests).not.toContain(`/update/${feed.artifact}`);

    await page.getByRole('button', { name: 'Download now' }).click();
    await expect.poll(() => feed.requests).toContain(`/update/${feed.artifact}`);
    await expect(page.getByRole('button', { name: 'Restart & Install' })).toBeVisible();
    await expect(page.getByText('Download finished. Restart the app to install.', { exact: true })).toBeVisible();
    const downloaded = await readFile(join(cachePath, 'mongog-updater', 'pending', feed.artifact));
    expect(createHash('sha512').update(downloaded).digest('base64')).toBe(feed.sha512);
    // Deliberately do not install the fixture. Real Squirrel/RPM installation
    // remains protected by the separate user restart action.
  } finally {
    try { await closeApplication(); } finally {
      await feed.close();
      await removeElectronUserData(cachePath);
    }
  }
});

for (const failure of ['checksum', 'http'] as const) {
  test(`packaged updater rejects a real ${failure} download failure`, async () => {
    test.skip(process.platform === 'win32', 'Unsigned Windows packages use manual updates.');
    const cachePath = await mkdtemp(join(tmpdir(), 'mongog-update-failure-e2e-'));
    const feed = await startUpdateFeed('9.9.9', failure);
    try {
      const page = await launch({ MONGOG_UPDATE_FEED_URL: feed.url, MONGOG_UPDATE_E2E_VERSION: '' });
      page.once('dialog', (dialog) => dialog.dismiss());
      await isolateUpdateCache(application!, cachePath);
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

test('Updates tab is reachable from Settings and shows the neutral state without a badge', async () => {
  let page = await launch();
  await expect(page.getByTitle(/MongoG version /)).toContainText('v1.2.12');
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

test('Query font zoom and Documents Criteria defaults are scoped and persistent', async ({}, testInfo) => {
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
    expect(await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor())).toBe(1);
    await openSettings();
    await expect(fontSize).toHaveValue('19');

    await page.getByRole('button', { name: 'Open Welcome' }).click();
    await page.getByRole('button', { name: 'New Connection', exact: true }).click();
    await page.getByLabel('Connection name').fill('Zoom E2E');
    await page.getByLabel('Connection URI').fill(mongoUri);
    await page.getByLabel('Default database').fill('mongog_e2e');
    await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
    await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
    const explorer = page.getByRole('navigation', { name: 'Connection explorer' });
    const profile = explorer.getByRole('treeitem', { name: 'Connection Zoom E2E' });
    await profile.focus();
    await profile.press('ArrowRight');
    const database = explorer.getByRole('treeitem', { name: 'Database mongog_e2e' });
    await expect(database).toBeVisible({ timeout: 15_000 });
    await database.focus();
    await database.press('ArrowRight');
    const collection = page.getByTitle('Open mongog_e2e.inventory');
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
    expect(await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor())).toBe(1);
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

test('Automatic await works in Query and Trusted modes with mapped Monaco diagnostics', async ({}, testInfo) => {
  const isolated = await mkdtemp(join(tmpdir(), 'mongog-await-e2e-'));
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  try {
    const page = await launch({MONGOG_E2E_USER_DATA:isolated});
    const errors: string[] = [];
    page.on('pageerror', error=>errors.push(error.stack ?? error.message));
    await page.getByRole('button', {name:'New Connection',exact:true}).click();
    await page.getByLabel('Connection name').fill('Auto Await E2E');
    await page.getByLabel('Connection URI').fill(mongoUri);
    await page.getByLabel('Default database').fill('mongog_e2e');
    await page.getByRole('button', {name:'Test, Save & Connect'}).click();
    await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({timeout:30000});
    await page.getByRole('button', {name:'Open global search'}).click();
    await page.getByLabel('Search databases and collections').fill('inventory');
    await page.getByRole('option', {name:/inventory Auto Await E2E/}).click();
    await page.getByRole('button', {name:'Query',exact:true}).click();
    const surface = page.getByTestId('query-editor-surface');
    const results = page.getByTestId('query-results-region');
    const source = `const items=db.collection<{sku:string, quantity:number}>("inventory");
const item=items.findOne({sku:"alpha"});
if(items.countDocuments({})>0) print(item?.sku);
item?.sku.toUpperCase();`;
    await setQueryEditorValue(page, source);
    await page.getByRole('button', {name:/^Run /}).click();
    await expect(results).toContainText('ALPHA');
    // Force the language worker to answer a real document-field completion.
    await setQueryEditorValue(page, source+'\nitem?.qu');
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.suggest-widget.visible')).toContainText('quantity', {timeout:15000});
    await page.keyboard.press('Escape');
    await setQueryEditorValue(page, source+'\nitem?.fieldThatDoesNotExist;');
    await expect(surface.locator('.squiggly-error')).not.toHaveCount(0, {timeout:15000});
    await expectQueryErrorOnLine(page, 'fieldThatDoesNotExist');
    await setQueryEditorValue(page, source);
    await expect(surface.locator('.squiggly-error')).toHaveCount(0, {timeout:15000});
    await expect.poll(() => page.evaluate(async () => (await window.mongog.workspace.load())?.tabs.find(tab=>tab.kind==='collection')?.editorContent)).toBe(source);

    page.once('dialog', dialog=>dialog.accept());
    await page.getByLabel('Execution mode').selectOption('trusted');
    await setQueryEditorValue(page, source.replace('toUpperCase()', 'toLowerCase()'));
    await page.getByRole('button', {name:/^Run /}).click();
    await expect(results.locator('pre').last()).toContainText('alpha');

    // Existing explicit awaits and promise continuations remain valid.
    await setQueryEditorValue(page, 'await db.collection("inventory").findOne({sku:"beta"}).then(item=>item.sku.toUpperCase());');
    await page.getByRole('button', {name:/^Run /}).click();
    await expect(results).toContainText('BETA');

    // Select only line 2: the first line must not execute, and failure markers
    // must be on the original selection line instead of generated helper code.
    const selectedSource='throw new Error("must not run");\nconst item=db.collection("inventory").findOne({sku:"alpha"}); item.sku;';
    await setQueryEditorValue(page, selectedSource);
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.press(`${modifier}+Enter`);
    await expect(results).toContainText('alpha');
    await expect(results).not.toContainText('must not run');
    await setQueryEditorValue(page, 'throw new Error("must not run");\nconst missing=db.collection("inventory").findOne({sku:"absent"}); missing.sku;');
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.press(`${modifier}+Enter`);
    await expect(results).toContainText('Statement 2');
    await expect(results).not.toContainText('must not run');
    await expectQueryErrorOnLine(page, 'missing.sku');
    await page.screenshot({path:testInfo.outputPath('automatic-await.png')});
    expect(errors).toEqual([]);
  } finally {
    try { await closeApplication(); } finally { await removeElectronUserData(isolated); }
  }
});

test('Documents column filters complete syntax and nested fields with native editing', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const isolated = await mkdtemp(join(tmpdir(), 'mongog-filter-language-'));
  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    await client.db('mongog_e2e').collection('filter_language').insertMany([
      { sku: 'alpha', quantity: 3, tags: ['wifi', 'balcony'], catalog: { city: 'Istanbul', products: [{ name: 'Computer Pro', price: 150, tags: ['wifi'] }] } },
      { sku: 'beta', quantity: 7, tags: ['pool'], catalog: { city: 'Ankara', products: [{ name: 'Phone', price: 300 }] } },
    ]);
    const page = await launch({ MONGOG_E2E_USER_DATA: isolated });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.getByRole('button', { name: 'New Connection', exact: true }).click();
    await page.getByLabel('Connection name').fill('Filter Language E2E');
    await page.getByLabel('Connection URI').fill(mongoUri);
    await page.getByLabel('Default database').fill('mongog_e2e');
    await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
    await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
    const explorer = page.getByRole('navigation', { name: 'Connection explorer' });
    await explorer.getByRole('treeitem', { name: 'Connection Filter Language E2E' }).press('ArrowRight');
    await explorer.getByRole('treeitem', { name: 'Database mongog_e2e' }).press('ArrowRight');
    await page.getByTitle('Open mongog_e2e.filter_language').click();
    const collectionTab = page.locator('[data-tab-kind="collection"][data-tab-active="true"]');
    const collectionTabId = await collectionTab.getAttribute('data-tab-id');
    const table = page.getByTestId('collection-documents-table');
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    const tags = page.getByLabel('Filter tags column');
    const catalog = page.getByLabel('Filter catalog column');
    const quantity = page.getByLabel('Filter quantity column');

    // A failed schema sample must not disable operator completion or editing.
    const failPoint = await client.db('admin').command({
      configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: ['aggregate'], errorCode: 13 },
    });
    await tags.fill('h wifi');
    await client.db('admin').command({ waitForFailPoint: 'failCommand', timesEntered: Number(failPoint.count) + 1, maxTimeMS: 10_000 });
    await tags.evaluate((input: HTMLInputElement) => input.setSelectionRange(1, 1));
    await tags.press('Control+Space');
    await expect(page.getByRole('option', { name: 'has Array contains a value or wildcard' })).toBeVisible();
    await tags.press('Enter');
    await expect(tags).toHaveValue('has wifi');
    await expect(page.getByRole('listbox', { name: 'Suggestions for tags' })).toHaveCount(0);
    await expect(rows).toHaveCount(2); // Choosing a valid completion must not apply it.
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await tags.press(`${modifier}+z`);
    await expect(tags).toHaveValue('h wifi');
    await tags.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
    await expect(tags).toHaveValue('has wifi');
    await tags.press('Escape');
    await tags.press('Enter');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('alpha');
    await tags.fill('');
    await tags.press('Enter');
    await expect(rows).toHaveCount(2);

    // Retry sampling on another focus and follow the selected nested array path.
    await catalog.fill('{products}[{na');
    const catalogList = page.getByRole('listbox', { name: 'Suggestions for catalog' });
    await expect(catalogList.getByRole('option', { name: /^name / })).toBeVisible({ timeout: 15_000 });
    await expect(catalogList).not.toContainText('Computer Pro');
    await catalog.press('Tab');
    await expect(catalog).toHaveValue('{products}[{name}]');
    await expect(catalog).toBeFocused();
    await catalog.pressSequentially(': *Com*');
    await expect(catalogList).toHaveCount(0);
    await catalog.press('Enter');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('alpha');
    await catalog.fill('{products}[{');
    await expect(catalogList.getByRole('option')).toHaveCount(3);
    await catalog.press('ArrowDown');
    await expect(catalogList.getByRole('option', { name: /^price / })).toHaveAttribute('aria-selected', 'true');
    await catalog.press('Escape');
    await expect(catalogList).toHaveCount(0);
    await catalog.press('Control+Space');
    await catalogList.getByRole('option', { name: /^tags / }).click();
    await expect(catalog).toHaveValue('{products}[{tags}]');
    await expect(catalog).toBeFocused();
    await catalog.pressSequentially(': len >= 1');
    await expect(catalogList).toHaveCount(0);

    // Use deliberate overflow, independent of the platform's monospace font.
    const catalogShell = page.locator('[data-column-filter="catalog"]');
    await expect(catalogShell.locator('[data-filter-token="property"]').first()).toHaveCSS('color', 'rgb(156, 220, 254)');
    const longFilter = `{products}[{name}]: "${'scroll alignment '.repeat(24)}"`;
    await catalog.fill(longFilter);
    await catalog.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
    await expect.poll(() => catalog.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(longFilter.length);
    await expect.poll(() => catalog.evaluate((input) => input.scrollWidth - input.clientWidth)).toBeGreaterThan(500);
    await expect.poll(() => catalog.evaluate((input) => input.scrollLeft)).toBeGreaterThan(0);
    await expectColumnFilterAlignment(catalogShell, 'end of long value');
    await catalog.pressSequentially('more');
    await expectColumnFilterAlignment(catalogShell, 'typing at the end');
    await catalog.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home');
    await expect.poll(() => catalog.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(0);
    await expect.poll(() => catalog.evaluate((input) => input.scrollLeft)).toBe(0);
    await expectColumnFilterAlignment(catalogShell, 'start of long value');
    await catalog.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
    await catalog.press('ArrowLeft');
    await catalog.press('Backspace');
    await expectColumnFilterAlignment(catalogShell, 'editing near the end');
    await quantity.focus();
    await expectColumnFilterAlignment(catalogShell, 'after blur');
    await catalog.focus();
    await dragHorizontalSeparator(page, page.getByRole('separator', { name: 'Resize catalog column' }), 40);
    await expectColumnFilterAlignment(catalogShell, 'wider column');
    await dragHorizontalSeparator(page, page.getByRole('separator', { name: 'Resize catalog column' }), -40);
    await expectColumnFilterAlignment(catalogShell, 'restored column width');
    await catalog.fill('{products}[{tags}]: len >= 1');
    await quantity.fill('<> 10');
    await page.screenshot({ path: testInfo.outputPath('column-filters-dark.png') });
    await page.getByRole('button', { name: 'Open application settings' }).click();
    await page.getByRole('radio', { name: 'Light theme', exact: true }).click();
    await page.locator(`[data-tab-id="${collectionTabId}"]`).click();
    await expect(catalogShell.locator('[data-filter-token="property"]').first()).toHaveCSS('color', 'rgb(0, 16, 128)');
    await page.screenshot({ path: testInfo.outputPath('column-filters-light.png') });
    await catalog.fill('{products}[{');
    await expect(catalogList).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('column-filter-suggestions.png') });
    const popupBounds = await catalogList.boundingBox();
    expect(popupBounds?.width).toBeGreaterThanOrEqual(280);
    expect((popupBounds?.x ?? -1) + (popupBounds?.width ?? 0)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
    await dragHorizontalSeparator(page, page.getByRole('separator', { name: 'Resize catalog column' }), -70);
    await expect(catalogList).toBeVisible();
    expect((await catalog.boundingBox())!.width).toBeLessThan(110);
    await table.evaluate((element) => { element.parentElement!.scrollLeft += 20; });
    await expect.poll(async () => Math.abs((await catalogList.boundingBox())!.x - (await catalog.boundingBox())!.x)).toBeLessThan(1);
    await catalog.press('Escape');
    await catalog.fill('{bad.name}: value');
    await expect(catalog).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
    await catalog.fill('"<img src=x onerror=alert(1)>"');
    await expect(catalogShell.locator('img')).toHaveCount(0);
    await expect(catalogShell.locator('.column-filter-text')).toHaveText('"<img src=x onerror=alert(1)>"');
    await quantity.fill('> 999');
    await quantity.dispatchEvent('compositionstart');
    await quantity.press('Enter');
    await expect(rows).toContainText('alpha');
    await quantity.dispatchEvent('compositionend');
    await catalog.fill('');
    await quantity.fill('');
    await quantity.press('Enter');
    await expect(rows).toHaveCount(2);
    await expectViewportLocked(page);
    expect(pageErrors).toEqual([]);
  } finally {
    await client.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' }).catch(() => undefined);
    await client.db('mongog_e2e').collection('filter_language').drop();
    await client.close();
    try { await closeApplication(); } finally { await removeElectronUserData(isolated); }
  }
});

async function expectColumnFilterAlignment(shell: Locator, description: string): Promise<void> {
  await test.step(`Column filter alignment: ${description}`, async () => {
    const measure = () => shell.evaluate((element) => {
      const input = element.querySelector('input')!;
      const text = element.querySelector('.column-filter-text')!;
      const metrics = (node: Element) => {
        const style = getComputedStyle(node);
        return {
          fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
          fontStyle: style.fontStyle, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
          padding: style.padding,
        };
      };
      return {
        scrollLeft: input.scrollLeft, scrollWidth: input.scrollWidth, clientWidth: input.clientWidth,
        caret: input.selectionStart, inputStyle: metrics(input), textStyle: metrics(text),
        // Measure painted position, not equality between two rounded scroll ranges.
        offsetError: text.getBoundingClientRect().left + input.scrollLeft - input.getBoundingClientRect().left,
      };
    });
    try {
      await expect.poll(async () => Math.abs((await measure()).offsetError), `${description}: painted text follows the native input scroll`).toBeLessThanOrEqual(1);
      const layout = await measure();
      expect(layout.textStyle, `${description}: overlay and input use the same text metrics`).toEqual(layout.inputStyle);
    } finally {
      const name = `column-filter-layout-${description.replaceAll(' ', '-')}`;
      const path = test.info().outputPath(`${name}.json`);
      await writeFile(path, JSON.stringify(await measure(), null, 2));
      await test.info().attach(name, { path, contentType: 'application/json' });
    }
  });
}

test('quitting with a pending window-state save exits cleanly', async () => {
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
  await application!.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    const bounds = window.getBounds();
    window.setBounds({ ...bounds, width: bounds.width + 1 });
  });
  await closeApplication();
});

async function expectQueryErrorOnLine(page: Page, text: string): Promise<void> {
  await expect.poll(() => page.getByTestId('query-editor-surface').evaluate((surface, text) => {
    const line = [...surface.querySelectorAll('.view-line')].find(line=>line.textContent?.includes(text));
    if (!line) return false;
    const bounds=line.getBoundingClientRect();
    return [...surface.querySelectorAll('.squiggly-error')].some(marker=> {
      const rect=marker.getBoundingClientRect();
      return rect.top >= bounds.top && rect.top < bounds.bottom;
    });
  }, text), {timeout:15000}).toBe(true);
}

async function setMonacoValue(page: Page, label: string, value: string): Promise<void> {
  const kind = label.replace('Collection ', '');
  await page.getByTestId(`criteria-editor-${kind}`).evaluate((element) => {
    (element as HTMLElement).click();
  });
  await expect(page.getByLabel(label)).toBeFocused();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(value);
}

async function setQueryEditorValue(page: Page, value: string): Promise<void> {
  await page.getByTestId('query-editor-surface').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(value);
}

async function expectCancelBelowSpinner(overlay: Locator): Promise<void> {
  const spinner = await overlay.locator('.loading-overlay-spinner').boundingBox();
  const cancel = await overlay.getByRole('button', { name: 'Cancel' }).boundingBox();
  if (!spinner || !cancel) throw new Error('Expected loading spinner and Cancel button bounds');
  expect(cancel.y).toBeGreaterThan(spinner.y + spinner.height);
}

async function collectionColumnNames(page: Page): Promise<string[]> {
  return page.getByTestId('collection-documents-table').locator('[data-sort-column]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-sort-column') ?? ''));
}

async function queryColumnNames(page: Page): Promise<string[]> {
  return page.getByTestId('query-documents-table').locator('thead th')
    .evaluateAll((elements) => elements.map((element) => element.textContent?.trim() ?? ''));
}

async function dragVerticalSeparator(page: Page, separator: ReturnType<Page['locator']>, deltaY: number): Promise<void> {
  const box = await separator.boundingBox();
  if (!box) throw new Error('Vertical resize handle is missing');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const pointerId = 1;
  await separator.dispatchEvent('pointerdown', {
    clientX: x,
    clientY: y,
    pointerId,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    bubbles: true,
  });
  await page.evaluate(({ clientX, clientY, movement, id }) => {
    const steps = 6;
    for (let step = 1; step <= steps; step += 1) {
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX,
        clientY: clientY + (movement * step) / steps,
        pointerId: id,
        pointerType: 'mouse',
        isPrimary: true,
        button: -1,
        buttons: 1,
        bubbles: true,
      }));
    }
    window.dispatchEvent(new PointerEvent('pointerup', {
      clientX,
      clientY: clientY + movement,
      pointerId: id,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 0,
      bubbles: true,
    }));
  }, { clientX: x, clientY: y, movement: deltaY, id: pointerId });
}

async function dragHorizontalSeparator(page: Page, separator: ReturnType<Page['locator']>, deltaX: number): Promise<void> {
  const box = await separator.boundingBox();
  if (!box) throw new Error('Horizontal resize handle is missing');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const pointerId = 2;
  await separator.dispatchEvent('pointerdown', {
    clientX: x,
    clientY: y,
    pointerId,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    bubbles: true,
  });
  await page.evaluate(({ clientX, clientY, movement, id }) => {
    const steps = 6;
    for (let step = 1; step <= steps; step += 1) {
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: clientX + (movement * step) / steps,
        clientY,
        pointerId: id,
        pointerType: 'mouse',
        isPrimary: true,
        button: -1,
        buttons: 1,
        bubbles: true,
      }));
    }
    window.dispatchEvent(new PointerEvent('pointerup', {
      clientX: clientX + movement,
      clientY,
      pointerId: id,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 0,
      bubbles: true,
    }));
  }, { clientX: x, clientY: y, movement: deltaX, id: pointerId });
}

async function dragWorkspaceTabBefore(page: Page, sourceId: string, targetId: string): Promise<void> {
  await page.evaluate(({ sourceId: source, targetId: target }) => {
    const sourceElement = document.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(source)}"] [data-tab-drag-handle]`,
    );
    const targetElement = document.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(target)}"]`);
    if (!sourceElement || !targetElement) throw new Error('Workspace tab drag target is missing');
    const dataTransfer = new DataTransfer();
    const targetRect = targetElement.getBoundingClientRect();
    sourceElement.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }));
    targetElement.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientX: targetRect.left + 2,
      clientY: targetRect.top + targetRect.height / 2,
      dataTransfer,
    }));
    targetElement.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: targetRect.left + 2,
      clientY: targetRect.top + targetRect.height / 2,
      dataTransfer,
    }));
    sourceElement.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }));
  }, { sourceId, targetId });
}

async function expectViewportLocked(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({
    horizontalOverflow: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ) - window.innerWidth,
    verticalOverflow: Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    ) - window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }))).toEqual({
    horizontalOverflow: 0,
    verticalOverflow: 0,
    scrollX: 0,
    scrollY: 0,
  });
}

async function expectWorkspaceSurfaceFullWidth(page: Page, testId: string): Promise<void> {
  await expect.poll(() => page.getByTestId(testId).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const navigation = document.querySelector('nav[aria-label="Connection explorer"]');
    const surface = element.querySelector('[data-testid="query-editor-surface"]');
    const monaco = surface?.querySelector('.monaco-editor');
    if (!navigation || !surface || !monaco) return Number.POSITIVE_INFINITY;

    const navigationRect = navigation.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const monacoRect = monaco.getBoundingClientRect();
    return Math.round(Math.max(
      Math.abs(rect.left - navigationRect.right),
      Math.abs(window.innerWidth - rect.right),
      Math.abs(surfaceRect.left - monacoRect.left),
      Math.abs(surfaceRect.right - monacoRect.right),
    ));
  })).toBeLessThanOrEqual(1);
}

async function expectQueryEditorFullHeight(page: Page): Promise<void> {
  await expect.poll(() => page.getByTestId('query-editor').evaluate((element) => (
    Math.round(Math.abs(window.innerHeight - element.getBoundingClientRect().bottom))
  ))).toBeLessThanOrEqual(1);
}

async function expectQueryColumnsFillWidth(page: Page): Promise<void> {
  await expect.poll(() => page.getByTestId('query-documents-table-wrap').evaluate((wrapper) => {
    const table = wrapper.querySelector('table');
    const headerRow = wrapper.querySelector('thead tr');
    const lastHeader = wrapper.querySelector('th:last-child');
    if (!table || !headerRow || !lastHeader) return Number.POSITIVE_INFINITY;
    const tableRect = table.getBoundingClientRect();
    const headerRowRect = headerRow.getBoundingClientRect();
    const lastHeaderRect = lastHeader.getBoundingClientRect();
    return Math.round(Math.max(
      // A table must fill the visible viewport, but it may legitimately be
      // wider when its minimum column widths require horizontal scrolling.
      Math.max(0, wrapper.clientWidth - tableRect.width),
      Math.abs(tableRect.width - headerRowRect.width),
      Math.abs(tableRect.right - lastHeaderRect.right),
    ));
  })).toBeLessThanOrEqual(2);
}

async function closeApplication(): Promise<void> {
  const closing = application;
  if (!closing) return;
  try {
    await test.step('Quit Electron and wait for its process to exit', () => closeElectron(closing));
  } finally {
    application = null;
  }
}

async function launch(extraEnv: Record<string, string> = {}): Promise<Page> {
  if (application) throw new Error('Close the previous Electron application before relaunching.');
  const executablePath = packagedExecutable();
  application = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      MONGOG_E2E_USER_DATA: userDataPath,
      // Keep the update check hermetic: an unreachable local feed fails fast into
      // the 'error' phase (no sidebar badge, no consent dialog) so the neutral e2e
      // paths never touch the network. Update tests override this with the
      // deterministic MONGOG_UPDATE_E2E_VERSION seam instead.
      MONGOG_UPDATE_FEED_URL: 'http://127.0.0.1:1/update',
      ...extraEnv,
    },
  });
  mkdirSync(test.info().outputDir, { recursive: true });
  const logPath = test.info().outputPath(`electron-${++launchNumber}.log`);
  const log = (message: string) => appendFileSync(logPath, `${redactForLog(message)}\n`);
  const child = application.process();
  log(`Electron launched: platform=${process.platform} arch=${process.arch} pid=${child.pid}`);
  for (const stream of [child.stdout, child.stderr]) {
    if (stream) createInterface({ input: stream }).on('line', log);
  }
  child.once('close', (code, signal) => log(`Electron closed: code=${code} signal=${signal}`));
  await application.evaluate(({ app }) => {
    process.on('uncaughtExceptionMonitor', (error) => console.error('[E2E main uncaught exception]', error));
    app.on('before-quit', () => console.log('[E2E lifecycle] before-quit'));
    app.on('will-quit', () => console.log('[E2E lifecycle] will-quit'));
    app.on('quit', () => console.log('[E2E lifecycle] quit'));
  });
  const page = await application.firstWindow();
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('MongoG test window was not created');
    window.setSize(1000, 700);
  });
  await expect.poll(() => page.evaluate(() => ({ width: window.outerWidth, height: window.outerHeight })))
    .toEqual({ width: 1000, height: 700 });
  return page;
}

async function isolateUpdateCache(application: ElectronApplication, directory: string): Promise<void> {
  const configuration = await application.evaluate(({ app }, cachePath) => {
    const require = process.getBuiltinModule('module').createRequire(`${app.getAppPath()}/package.json`);
    const { autoUpdater } = require('electron-updater');
    // Override only the cache root on the real adapter, before the first
    // download. Do not override configOnDisk or downloadedUpdateHelper: those
    // must read the actual bundled app-update.yml to catch packaging regressions.
    Object.defineProperty(autoUpdater.app, 'baseCachePath', { get: () => cachePath });
    return {
      type: autoUpdater.constructor.name,
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
      cachePath: autoUpdater.app.baseCachePath,
    };
  }, directory);
  expect(configuration).toEqual({
    type: process.platform === 'darwin' ? 'MacUpdater' : 'RpmUpdater',
    autoDownload: false,
    autoInstallOnAppQuit: false,
    cachePath: directory,
  });
}

async function startUpdateFeed(version: string, failure?: 'checksum' | 'http'): Promise<{
  url: string;
  manifest: string;
  artifact: string;
  sha512: string;
  requests: string[];
  close: () => Promise<void>;
}> {
  const manifest = process.platform === 'darwin' ? 'latest-mac.yml' : 'latest-linux.yml';
  const artifact = process.platform === 'darwin'
    ? `MongoG-${version}-macOS-${process.arch}.zip`
    : `mongog-${version}-1.x86_64.rpm`;
  // Small download-only fixture (an empty ZIP on macOS). The tests never invoke
  // the native installer, but exercise actual HTTP, cache writes and SHA-512.
  const payload = process.platform === 'darwin'
    ? Buffer.from('504b0506000000000000000000000000000000000000', 'hex')
    : Buffer.from('MongoG RPM download-only test fixture\n');
  const sha512 = failure === 'checksum'
    ? Buffer.alloc(64, 7).toString('base64')
    : createHash('sha512').update(payload).digest('base64');
  const body = [
    `version: "${version}"`,
    'files:',
    `  - url: "${artifact}"`,
    `    sha512: "${sha512}"`,
    `    size: ${payload.length}`,
    `path: "${artifact}"`,
    `sha512: "${sha512}"`,
    '',
  ].join('\n');
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const requestUrl = request.url ?? '/';
    const pathname = requestUrl.split('?', 1)[0] ?? '/';
    requests.push(pathname);
    if (pathname === `/update/${manifest}`) {
      response.writeHead(200, { 'Content-Type': 'text/yaml', 'Cache-Control': 'no-store' });
      response.end(body);
      return;
    }
    if (pathname === `/update/${artifact}`) {
      if (failure === 'http') {
        response.writeHead(503);
        response.end('Update fixture unavailable');
      } else {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length });
        response.end(payload);
      }
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/update`,
    manifest,
    artifact,
    sha512,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function redirectSaveDialogs(app: ElectronApplication, directory: string): Promise<void> {
  await app.evaluate(({ dialog }, targetDirectory) => {
    const target = dialog as unknown as {
      showSaveDialog: (...args: unknown[]) => Promise<{ canceled: boolean; filePath: string }>;
    };
    target.showSaveDialog = async (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as { defaultPath?: string };
      const filename = String(options.defaultPath ?? 'export.dat').replace(/^.*[\\/]/u, '');
      return { canceled: false, filePath: `${targetDirectory}/${filename}` };
    };
  }, directory);
}

async function redirectOpenDialogs(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    const target = dialog as unknown as {
      showOpenDialog: (...args: unknown[]) => Promise<{ canceled: boolean; filePaths: string[] }>;
    };
    target.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, filePaths);
}

function packagedExecutable(): string {
  const configuredExecutable = process.env.MONGOG_E2E_EXECUTABLE?.trim();
  if (configuredExecutable) {
    if (!existsSync(configuredExecutable)) throw new Error(`MONGOG_E2E_EXECUTABLE does not exist: ${configuredExecutable}`);
    return configuredExecutable;
  }
  const macArchitectures = process.arch === 'x64' ? ['x64', 'arm64'] : ['arm64', 'x64'];
  const candidates = process.platform === 'darwin'
    ? macArchitectures.flatMap((arch) => [
        join(process.cwd(), `out/MongoG-darwin-${arch}/MongoG.app/Contents/MacOS/MongoG`),
        join(process.cwd(), `out/MongoG-darwin-${arch}/MongoG.app/Contents/MacOS/mongog`),
      ])
    : process.platform === 'win32'
      ? [
          join(process.cwd(), 'out/MongoG-win32-x64/MongoG.exe'),
          join(process.cwd(), 'out/MongoG-win32-x64/mongog.exe'),
        ]
      : [
          join(process.cwd(), 'out/MongoG-linux-x64/mongog'),
          join(process.cwd(), 'out/MongoG-linux-x64/MongoG'),
        ];
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error('Packaged MongoG executable not found. Run npm run package first.');
  return executable;
}
