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

test('global collection defaults persist and auto-run a new Query collection once', async ({ mongog }) => {
  const harness = createE2EHarness(mongog);
  const { launch, closeApplication, mongoUri, userDataPath, databaseName } = harness;
  let page = await launch();
  await expect(page.locator('[data-tab-kind="welcome"]')).toHaveAttribute('data-tab-active', 'true');
  const releaseNotesTab = page.locator('[data-tab-kind="release-notes"]');
  // Keep this persistence test independent from the preceding lifecycle test:
  // if that test is interrupted before its final save, establish the same
  // starting workspace explicitly instead of reporting a cascading failure.
  if (await releaseNotesTab.count() === 0) {
    await page.getByRole('button', { name: 'What’s New in 1.2.22' }).click();
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
  await page.getByLabel('Default database').fill(databaseName);
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
    await lifecycleClient.db(databaseName).collection('inventory').updateOne(
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

    await lifecycleClient.db(databaseName).collection('inventory').updateOne(
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

    await lifecycleClient.db(databaseName).collection('inventory_secondary').insertOne({
      sku: 'secondary',
      quantity: 1,
    });
    const defaultsExplorer = page.getByRole('navigation', { name: 'Connection explorer' });
    const defaultsProfile = defaultsExplorer.getByRole('treeitem', { name: 'Connection Defaults E2E' });
    await expect(defaultsProfile).toHaveAttribute('aria-expanded', 'true');
    const defaultsDatabase = defaultsExplorer.getByRole('treeitem', { name: `Database ${databaseName}` });
    await expect(defaultsDatabase).toBeVisible({ timeout: 15_000 });
    await defaultsDatabase.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Refresh Collections' }).click();
    await defaultsDatabase.focus();
    await defaultsDatabase.press('ArrowRight');
    const secondaryCollection = page.getByTitle(`Open ${databaseName}.inventory_secondary`);
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
    await page.getByTitle(`Close ${databaseName}.inventory_secondary`).click();
    await expect(page.locator(`[data-collection-surface="${secondaryTabId}"]`)).toHaveCount(0);
  } finally {
    await lifecycleClient.db('admin').command({
      configureFailPoint: 'failCommand',
      mode: 'off',
    }).catch(() => undefined);
    await lifecycleClient.db(databaseName).collection('inventory').updateOne(
      { sku: 'alpha' },
      { $unset: { tabSwitchProbe: '' } },
    ).catch(() => undefined);
    await lifecycleClient.db(databaseName).collection('inventory_secondary').drop()
      .catch(() => undefined);
    await lifecycleClient.close();
  }
});

test('Automatic await works in Query and Trusted modes with mapped Monaco diagnostics', async ({ mongog }, testInfo) => {
  const harness = createE2EHarness(mongog);
  const { launch, closeApplication, mongoUri, userDataPath, databaseName } = harness;
  const isolated = await mkdtemp(join(tmpdir(), 'mongog-await-e2e-'));
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  try {
    const page = await launch({MONGOG_E2E_USER_DATA:isolated});
    const errors: string[] = [];
    page.on('pageerror', error=>errors.push(error.stack ?? error.message));
    await page.getByRole('button', {name:'New Connection',exact:true}).click();
    await page.getByLabel('Connection name').fill('Auto Await E2E');
    await page.getByLabel('Connection URI').fill(mongoUri);
    await page.getByLabel('Default database').fill(databaseName);
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
