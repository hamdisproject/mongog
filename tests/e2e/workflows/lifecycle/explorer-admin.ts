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

export async function runExplorerAndAdministration(
  context: LifecycleContext,
  state: LifecycleWorkspaceState,
): Promise<LifecycleSettingsState> {
  const { harness, databaseName, mongoUri } = context;
  const { page, explorer, queryTabId, collectionTabId } = state;
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
  const disconnectedProfile = explorer.getByRole('treeitem', { name: 'Connection E2E Renamed' });
  await expect(disconnectedProfile).toHaveAttribute('aria-expanded', 'false');
  await disconnectedProfile.dblclick();
  await expect(explorer.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await expect(disconnectedProfile).toHaveAttribute('aria-expanded', 'false');
  await explorer.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(explorer.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await expect(disconnectedProfile).toHaveAttribute('aria-expanded', 'true');
  await expect(explorer.getByRole('treeitem', { name: `Database ${databaseName}` }))
    .toBeVisible({ timeout: 15_000 });

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
  await expect(profileTreeItem).toHaveAttribute('aria-expanded', 'true');
  await expect(profileTreeItem).toBeFocused();
  const databaseTreeItem = explorer.getByRole('treeitem', { name: `Database ${databaseName}` });
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
  const collectionTreeItem = explorer.getByRole('treeitem', { name: `Collection ${databaseName}.inventory` });
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
  await expect(page.getByTitle(`Open ${databaseName}.inventory`)).toBeVisible();
  await explorer.getByLabel('Search connections').fill('');

  await page.getByTitle(`Open ${databaseName}.inventory`).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Indexes' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Indexes' }).click();
  await expect(page.locator(`[title^="admin: Indexes · ${databaseName}.inventory"]`)).toBeVisible();
  await expect(page.getByText('Indexes', { exact: true }).first()).toBeVisible();
  await page.getByTitle(`Open ${databaseName}.inventory`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Watch Changes' }).click();
  const changeStreamTab = page.locator(`[title^="change-stream: Changes · ${databaseName}.inventory"]`);
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

  await page.getByTitle(`Open ${databaseName}.inventory`).click();
  await expect(page.locator('[data-change-stream-surface]')).toHaveCount(1);
  const eventClient = new MongoClient(mongoUri);
  await eventClient.connect();
  try {
    await eventClient.db(databaseName).collection('inventory').updateOne(
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

  await page.getByTitle(`Open ${databaseName}.inventory`).click();
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
  return {
    ...state,
    alphabeticalColumnOrder,
    documentColumnOrder,
    documentsTable,
    quantityHeader,
  };
}
