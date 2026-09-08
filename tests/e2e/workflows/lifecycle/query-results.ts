import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { MongoClient } from 'mongodb';

import { expect } from '../../fixtures/mongog-test.js';
import {
  collectionColumnNames,
  dragHorizontalSeparator,
  dragVerticalSeparator,
  dragWorkspaceTabBefore,
  expectQueryColumnsFillWidth,
  expectQueryEditorFullHeight,
  expectViewportLocked,
  expectWorkspaceSurfaceFullWidth,
  queryColumnNames,
  setMonacoValue,
  setQueryEditorValue,
} from '../../helpers/ui.js';
import type {
  LifecycleContext,
  LifecycleSettingsState,
  LifecycleState,
  LifecycleWorkspaceState,
} from './context.js';

export async function runQueryResultsAndCleanup(
  context: LifecycleContext,
  state: LifecycleSettingsState,
): Promise<void> {
  const { harness, userDataPath, textPattern, databaseName, mongoUri } = context;
  const {
    page,
    explorer,
    queryTabId,
    collectionTabId,
    alphabeticalColumnOrder,
    documentColumnOrder,
  } = state;
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
  const copyDocumentStatement = page.getByRole('button', {
    name: 'Copy Statement 1 output',
    exact: true,
  });
  await copyDocumentStatement.click();
  await expect(statement).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (
    await harness.application!.evaluate(({ clipboard }) => clipboard.readText())
  )).toContain('sku: "beta"');
  await expect.poll(async () => (
    await harness.application!.evaluate(({ clipboard }) => clipboard.readText())
  )).toMatch(/^\[[\s\S]*\]$/u);
  const statementCopiedToast = page.getByTestId('toast-notification')
    .filter({ hasText: 'Statement output copied.' });
  await expect(statementCopiedToast).toHaveRole('status');
  await expect(statementCopiedToast).toBeVisible();
  await expect(statementCopiedToast).toHaveCount(0, { timeout: 5_000 });

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
    textPattern.test(file)
  ))).toBe(true);
  const queryTxtName = (await readdir(userDataPath)).find((file) => textPattern.test(file))!;
  const queryTxt = await readFile(join(userDataPath, queryTxtName), 'utf8');
  expect(queryTxt).toContain('sku');
  expect(queryTxt).toContain('beta');

  const nullValueClient = new MongoClient(mongoUri);
  await nullValueClient.connect();
  try {
    await nullValueClient.db(databaseName).collection('inventory').updateOne(
      { sku: 'alpha' },
      { $set: { status: null } },
    );
  } finally {
    await nullValueClient.close(true);
  }
  await page.getByRole('button', { name: /^Run/ }).click();
  await expect.poll(async () => (
    (await queryColumnNames(page)).indexOf('status')
  )).toBeGreaterThan(0);
  const statusColumnIndex = (await queryColumnNames(page)).indexOf('status');
  const typedResultsTable = page.getByTestId('query-documents-table');
  await expect(typedResultsTable.locator('tbody tr').filter({ hasText: '"alpha"' })
    .locator('td').nth(statusColumnIndex)).toHaveText('null');
  await expect(typedResultsTable.locator('tbody tr').filter({ hasText: '"beta"' })
    .locator('td').nth(statusColumnIndex)).toHaveText('Not Set');

  await setQueryEditorValue(page, 'Int32(41);');
  await page.getByRole('button', { name: /^Run/ }).click();
  await expect(page.getByText('scalar', { exact: true })).toBeVisible({ timeout: 30_000 });
  const scalarStatement = page.getByRole('button', { name: /Statement 1.*scalar/ });
  const copyScalarStatement = page.getByRole('button', {
    name: 'Copy Statement 1 output',
    exact: true,
  });
  await copyScalarStatement.click();
  await expect(scalarStatement).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (
    await harness.application!.evaluate(({ clipboard }) => clipboard.readText())
  )).toBe('41');
  await expect(page.getByTestId('toast-notification').filter({ hasText: 'Statement output copied.' }))
    .toBeVisible();
  await expect(page.getByTestId('toast-notification').filter({ hasText: 'Statement output copied.' }))
    .toHaveCount(0, { timeout: 5_000 });

  await page.evaluate(() => {
    const clipboard = navigator.clipboard as Clipboard & { __mongogOriginalWriteText?: Clipboard['writeText'] };
    clipboard.__mongogOriginalWriteText = clipboard.writeText;
    clipboard.writeText = () => Promise.reject(new Error('Simulated clipboard failure'));
  });
  await copyScalarStatement.click();
  const statementCopyError = page.getByTestId('toast-notification')
    .filter({ hasText: 'Could not copy statement output.' });
  await expect(statementCopyError).toHaveRole('alert');
  await expect(statementCopyError).toBeVisible();
  await page.evaluate(() => {
    const clipboard = navigator.clipboard as Clipboard & { __mongogOriginalWriteText?: Clipboard['writeText'] };
    if (clipboard.__mongogOriginalWriteText) {
      clipboard.writeText = clipboard.__mongogOriginalWriteText;
      delete clipboard.__mongogOriginalWriteText;
    }
  });
  await expect(statementCopyError).toHaveCount(0, { timeout: 5_000 });

  await setQueryEditorValue(page, [
    'console.log("copy-value", ObjectId("64b64c000000000000000001"));',
    'console.warn({ count: Int32(7), nested: { enabled: true } });',
  ].join('\n'));
  await page.getByRole('button', { name: /^Run/ }).click();
  const copyConsoleOutput = page.getByRole('button', { name: 'Copy console output' });
  await expect(copyConsoleOutput).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('console.log "copy-value" ObjectId("64b64c000000000000000001")', { exact: true }))
    .toHaveCSS('user-select', 'text');
  await copyConsoleOutput.click();
  await expect.poll(async () => (
    await harness.application!.evaluate(({ clipboard }) => clipboard.readText())
  ).replace(/\r\n?/gu, '\n'))
    .toBe([
      'console.log "copy-value" ObjectId("64b64c000000000000000001")',
      'console.warn { count: 7, nested: { enabled: true } }',
    ].join('\n'));
  const copiedToast = page.getByTestId('toast-notification').filter({ hasText: 'Console output copied.' });
  await expect(copiedToast).toHaveRole('status');
  await expect(copiedToast).toBeVisible();
  await expect(copiedToast).toHaveCount(0, { timeout: 5_000 });

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
  await page.getByRole('button', { name: 'What’s New in 1.2.22' }).click();
  await expect(page.locator('[data-tab-kind="release-notes"]')).toHaveCount(1);
}
