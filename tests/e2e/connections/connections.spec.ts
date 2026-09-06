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

test('Explorer collection opening preference creates independent tabs or reuses the first match', async ({ mongog }) => {
  const harness = createE2EHarness(mongog);
  const { launch, closeApplication, mongoUri, userDataPath, databaseName } = harness;
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
  await page.getByLabel('Default database').fill(databaseName);
  await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
  await expect(page.getByText('Connection tested, saved, and connected.'))
    .toBeVisible({ timeout: 30_000 });

  const explorer = page.getByRole('navigation', { name: 'Connection explorer' });
  const profile = explorer.getByRole('treeitem', { name: 'Connection Explorer Tabs E2E' });
  await profile.focus();
  await profile.press('ArrowRight');
  const database = explorer.getByRole('treeitem', { name: `Database ${databaseName}` });
  await expect(database).toBeVisible({ timeout: 15_000 });
  await database.focus();
  await database.press('ArrowRight');
  const collection = page.getByTitle(`Open ${databaseName}.inventory`);
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
    await client.db(databaseName).collection('inventory').updateOne(
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
    await client.db(databaseName).collection('inventory').updateOne(
      { sku: 'alpha' },
      { $unset: { explorerTabProbe: '' } },
    ).catch(() => undefined);
    await client.close();
  }
});

test('Explorer creates and renames databases and disables mutations for read-only connections', async ({ mongog }) => {
  const harness = createE2EHarness(mongog);
  const { launch, closeApplication, mongoUri, userDataPath, databaseName } = harness;
  test.setTimeout(120_000);
  const isolated = await mkdtemp(join(tmpdir(), 'mongog-database-ops-e2e-'));
  const source = `${databaseName}_created_database`;
  const target = `${databaseName}_renamed_database`;
  try {
    const page = await launch({ MONGOG_E2E_USER_DATA: isolated });
    await page.getByRole('button', { name: 'New Connection', exact: true }).click();
    await page.getByLabel('Connection name').fill('Database Ops E2E');
    await page.getByLabel('Connection URI').fill(mongoUri);
    await page.getByLabel('Default database').fill(databaseName);
    await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
    await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });

    const explorer = page.getByRole('navigation', { name: 'Connection explorer' });
    const profile = explorer.getByRole('treeitem', { name: 'Connection Database Ops E2E' });
    await profile.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Create Database…' }).click();
    const createDialog = page.getByRole('dialog', { name: 'Create database' });
    await createDialog.getByLabel('Database name').fill(source);
    await createDialog.getByLabel('Initial collection name').fill('initial');
    await createDialog.getByRole('button', { name: 'Create', exact: true }).click();

    const profileTree = profile.locator('..');
    const sourceDatabase = profileTree.getByRole('treeitem', { name: `Database ${source}` });
    await expect(sourceDatabase).toBeVisible({ timeout: 15_000 });
    const collection = profileTree.getByTitle(`Open ${source}.initial`);
    await expect(collection).toBeVisible();
    await collection.click();
    const collectionTab = page.locator('[data-tab-kind="collection"][data-tab-active="true"]');
    await expect(collectionTab).toHaveAttribute('title', `collection: ${source}.initial`);

    const mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    try {
      await mongoClient.db(source).collection('initial').insertOne({ preserved: true });
    } finally {
      await mongoClient.close();
    }

    await sourceDatabase.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename Database…' }).click();
    const renameDialog = page.getByRole('dialog', { name: 'Rename database' });
    await expect(renameDialog).toContainText('no atomic database rename');
    await expect(renameDialog).toContainText('cursors and change streams will be invalidated');
    await renameDialog.getByLabel('New database name').fill(target);
    await renameDialog.getByLabel(`Type "${source}" to confirm`).fill(source);
    await renameDialog.getByRole('button', { name: 'Rename database', exact: true }).click();

    const renameJobs = page.getByLabel('Database rename jobs');
    await expect(renameJobs.getByText('completed', { exact: true })).toBeVisible({ timeout: 30_000 });
    await renameJobs.getByRole('button', { name: 'Dismiss' }).click();
    await expect(renameJobs).toHaveCount(0);
    await expect(profileTree.getByRole('treeitem', { name: `Database ${target}` })).toBeVisible();
    await expect(profileTree.getByRole('treeitem', { name: `Database ${source}` })).toHaveCount(0);
    await expect(collectionTab).toHaveAttribute('title', `collection: ${target}.initial`);

    const verify = new MongoClient(mongoUri);
    await verify.connect();
    try {
      expect(await verify.db(target).collection('initial').findOne({ preserved: true })).toBeTruthy();
      const names = (await verify.db('admin').admin().listDatabases({ nameOnly: true })).databases
        .map((item) => item.name);
      expect(names).toContain(target);
      expect(names).not.toContain(source);
    } finally {
      await verify.close();
    }

    await page.getByRole('button', { name: 'New connection', exact: true }).click();
    await page.getByLabel('Connection name').fill('Read Only Database Ops');
    await page.getByLabel('Connection URI').fill(mongoUri);
    await page.getByLabel('Default database').fill(databaseName);
    await page.getByLabel('Protect this connection as read-only').check();
    await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
    await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
    const readOnlyProfile = explorer.getByRole('treeitem', { name: 'Connection Read Only Database Ops' });
    await readOnlyProfile.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Create Database…' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await readOnlyProfile.press('ArrowRight');
    const readOnlyDatabase = readOnlyProfile.locator('..').getByRole('treeitem', {
      name: `Database ${databaseName}`,
      exact: true,
    });
    await expect(readOnlyDatabase).toBeVisible({ timeout: 15_000 });
    await readOnlyDatabase.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Rename Database…' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Drop Database…' })).toBeDisabled();
  } finally {
    try { await closeApplication(); } finally { await removeElectronUserData(isolated); }
  }
});
