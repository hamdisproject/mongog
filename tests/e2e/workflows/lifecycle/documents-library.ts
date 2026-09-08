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

import { redirectSaveDialogs } from '../../helpers/dialogs.js';

export async function runDocumentsAndSavedLibrary(
  context: LifecycleContext,
  state: LifecycleSettingsState,
): Promise<LifecycleSettingsState> {
  const { harness, userDataPath, databaseName, mongoUri, csvPattern } = context;
  const {
    page,
    explorer,
    queryTabId,
    alphabeticalColumnOrder,
    documentColumnOrder,
    documentsTable,
    quantityHeader,
  } = state;
  let { collectionTabId } = state;
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
    await nestedCleanupClient.db(databaseName).collection('inventory').updateMany(
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
    .toHaveText('Not Set');
  await page.getByRole('button', { name: 'Calculate total document count' }).click();
  await expect(page.getByRole('button', { name: 'Calculate total document count' }))
    .toHaveText('Total count: 1');

  const quantityColumn = page.getByLabel('Filter quantity column');
  await quantityColumn.fill('> 4');
  await expect(page.getByRole('button', { name: /^Criteria.*edited/ })).toBeVisible();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('"beta"', { exact: true })).toBeVisible();

  await redirectSaveDialogs(harness.application!, userDataPath);
  await page.getByRole('button', { name: 'Export…', exact: true }).click();
  const documentsExportDialog = page.getByRole('dialog', { name: `Export ${databaseName}.inventory` });
  await expect(documentsExportDialog.getByRole('radio', { name: /Current page/ })).toBeChecked();
  await documentsExportDialog.getByRole('button', { name: /CSV/ }).click();
  await documentsExportDialog.getByRole('radio', { name: /All matching documents/ }).check();
  await documentsExportDialog.getByRole('button', { name: 'Continue…' }).click();
  await expect(page.getByText(csvPattern).first()).toBeVisible();
  await expect.poll(async () => (await readdir(userDataPath)).some((file) => (
    csvPattern.test(file)
  ))).toBe(true);
  const documentsCsvName = (await readdir(userDataPath)).find((file) => csvPattern.test(file))!;
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
  const saveDialog = page.getByRole('dialog', { name: 'Save item' });
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
  const reopenedCollectionTabId = await reopenedCollectionTab.getAttribute('data-tab-id');
  if (!reopenedCollectionTabId) throw new Error('Expected reopened collection tab id');
  collectionTabId = reopenedCollectionTabId;
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
  return { ...state, collectionTabId };
}
