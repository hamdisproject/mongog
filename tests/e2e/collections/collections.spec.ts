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

test('Documents column filters complete syntax and nested fields with native editing', async ({ mongog }, testInfo) => {
  const harness = createE2EHarness(mongog);
  const { launch, closeApplication, mongoUri, userDataPath, databaseName } = harness;
  test.setTimeout(120_000);
  const isolated = await mkdtemp(join(tmpdir(), 'mongog-filter-language-'));
  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    await client.db(databaseName).collection('filter_language').insertMany([
      { sku: 'alpha', quantity: 3, tags: ['wifi', 'balcony'], catalog: { city: 'Istanbul', products: [{ name: 'Computer Pro', price: 150, tags: ['wifi'] }] } },
      { sku: 'beta', quantity: 7, tags: ['pool'], catalog: { city: 'Ankara', products: [{ name: 'Phone', price: 300 }] } },
    ]);
    const page = await launch({ MONGOG_E2E_USER_DATA: isolated });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.getByRole('button', { name: 'New Connection', exact: true }).click();
    await page.getByLabel('Connection name').fill('Filter Language E2E');
    await page.getByLabel('Connection URI').fill(mongoUri);
    await page.getByLabel('Default database').fill(databaseName);
    await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
    await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
    const explorer = page.getByRole('navigation', { name: 'Connection explorer' });
    await explorer.getByRole('treeitem', { name: 'Connection Filter Language E2E' }).press('ArrowRight');
    await explorer.getByRole('treeitem', { name: `Database ${databaseName}` }).press('ArrowRight');
    await page.getByTitle(`Open ${databaseName}.filter_language`).click();
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
    await client.db(databaseName).collection('filter_language').drop();
    await client.close();
    try { await closeApplication(); } finally { await removeElectronUserData(isolated); }
  }
});

test('selected document rows support bulk updates and deletes', async ({ mongog }) => {
  const harness = createE2EHarness(mongog);
  const { launch, closeApplication, mongoUri, userDataPath, databaseName } = harness;
  test.setTimeout(120_000);
  const isolated = await mkdtemp(join(tmpdir(), 'mongog-bulk-update-'));
  const client = new MongoClient(mongoUri);
  await client.connect();
  const collection = client.db(databaseName).collection('bulk_update_e2e');
  await collection.deleteMany({});
  const inserted = await collection.insertMany([
    { sku: 'bulk-a', quantity: 1 },
    { sku: 'bulk-b', quantity: 2 },
  ]);
  try {
    const page = await launch({ MONGOG_E2E_USER_DATA: isolated });
    await page.getByRole('button', { name: 'New Connection', exact: true }).click();
    await page.getByLabel('Connection name').fill('Bulk Update E2E');
    await page.getByLabel('Connection URI').fill(mongoUri);
    await page.getByLabel('Default database').fill(databaseName);
    await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
    await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
    const explorer = page.getByRole('navigation', { name: 'Connection explorer' });
    await explorer.getByRole('treeitem', { name: 'Connection Bulk Update E2E' }).press('ArrowRight');
    await explorer.getByRole('treeitem', { name: `Database ${databaseName}` }).press('ArrowRight');
    await page.getByTitle(`Open ${databaseName}.bulk_update_e2e`).click();

    const table = page.getByTestId('collection-documents-table');
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    const selectAll = page.getByLabel('Select all documents on this page');
    const firstSelection = page.getByLabel('Select document row 1');
    await firstSelection.check();
    await expect(selectAll).toHaveJSProperty('indeterminate', true);
    await expect(page.getByTestId('document-panel')).toHaveCount(0);
    await selectAll.check();
    await expect(page.getByRole('button', { name: 'Edit selected (2)' })).toBeEnabled();

    await page.getByRole('button', { name: 'Edit selected (2)' }).click();
    const panel = page.getByTestId('document-panel');
    await expect(panel.getByText('Edit 2 selected document(s)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete selected (2)' })).toBeDisabled();
    const bulkFieldPath = panel.getByLabel('Bulk update field path');
    await bulkFieldPath.click();
    const bulkFieldOptions = page.getByRole('listbox', { name: 'Bulk update fields' });
    await expect(bulkFieldOptions).toBeVisible();
    await expect(bulkFieldOptions.getByRole('option', { name: 'sku', exact: true })).toBeVisible();
    await expect(bulkFieldOptions.getByRole('option', { name: 'quantity', exact: true })).toBeVisible();
    await expect(bulkFieldOptions.getByRole('option', { name: '_id', exact: true })).toHaveCount(0);
    const firstSuggestedField = await bulkFieldOptions.getByRole('option').first().textContent();
    if (!firstSuggestedField) throw new Error('Expected at least one bulk field suggestion');
    await bulkFieldPath.press('ArrowDown');
    await bulkFieldPath.press('Enter');
    await expect(bulkFieldPath).toHaveValue(firstSuggestedField);
    await panel.getByRole('button', { name: 'Show bulk update fields' }).click();
    await bulkFieldOptions.getByRole('option', { name: 'quantity', exact: true }).click();
    await expect(bulkFieldPath).toHaveValue('quantity');
    await bulkFieldPath.fill('metadata.status');
    await expect(bulkFieldOptions.getByText('No visible editable fields. Type a field path.')).toBeVisible();
    await bulkFieldPath.press('Tab');
    await expect(bulkFieldOptions).toHaveCount(0);
    await setEditorValueByLabel(page, harness.application!, 'Bulk field BSON value', '"ready"');
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('2 selected document(s)');
      await dialog.accept();
    });
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/Bulk update complete: 2 matched, 2 modified/)).toBeVisible();
    await expect.poll(async () => collection.countDocuments({ 'metadata.status': 'ready' })).toBe(2);

    await selectAll.check();
    await page.getByRole('button', { name: 'Edit selected (2)' }).click();
    await panel.getByRole('button', { name: 'Full documents' }).click();
    const firstId = inserted.insertedIds[0]!.toHexString();
    const secondId = inserted.insertedIds[1]!.toHexString();
    await setEditorValueByLabel(page, harness.application!, 'Bulk documents BSON editor', `[
      { _id: ObjectId("${secondId}"), sku: "bulk-b", quantity: Int32(20), rewritten: true },
      { _id: ObjectId("${firstId}"), sku: "bulk-a", quantity: Int32(10), rewritten: true },
    ]`);
    page.once('dialog', (dialog) => dialog.accept());
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/Bulk update complete: 2 matched, 2 modified/)).toBeVisible();
    await expect.poll(async () => collection.countDocuments({ rewritten: true })).toBe(2);

    await selectAll.check();
    await page.getByRole('button', { name: 'Edit selected (2)' }).click();
    await panel.getByLabel('Bulk update field path').fill('partialFlag');
    await setEditorValueByLabel(page, harness.application!, 'Bulk field BSON value', 'true');
    await collection.updateOne({ sku: 'bulk-a' }, { $set: { concurrent: true } });
    page.once('dialog', (dialog) => dialog.accept());
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('bulk-update-failures')).toContainText('1 failed');
    const staleRow = rows.filter({ hasText: 'bulk-a' });
    await expect(staleRow.getByRole('checkbox')).toBeChecked();
    await expect.poll(async () => collection.countDocuments({ partialFlag: true })).toBe(1);

    await setMonacoValue(page, 'Collection projection', '{ sku: 1 }');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await page.getByLabel('Select all documents on this page').check();
    await expect(page.getByRole('button', { name: 'Edit selected (2)' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete selected (2)' })).toBeDisabled();

    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Delete selected (0)' })).toBeDisabled();
    await selectAll.check();
    await expect(page.getByRole('button', { name: 'Delete selected (2)' })).toBeEnabled();

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe(
        `Delete 2 selected documents from ${databaseName}.bulk_update_e2e? This operation cannot be undone.`,
      );
      await dialog.dismiss();
    });
    await page.getByRole('button', { name: 'Delete selected (2)' }).click();
    await expect.poll(async () => collection.countDocuments({})).toBe(2);

    page.once('dialog', async (dialog) => {
      await collection.updateOne({ sku: 'bulk-a' }, { $set: { deleteConcurrent: true } });
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Delete selected (2)' }).click();
    await expect(page.getByTestId('bulk-delete-failures')).toContainText('1 failed');
    await expect.poll(async () => collection.countDocuments({})).toBe(1);
    const deleteStaleRow = rows.filter({ hasText: 'bulk-a' });
    await expect(deleteStaleRow.getByRole('checkbox')).toBeChecked();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete selected (1)' }).click();
    await expect(page.getByText('Bulk delete complete: 1 deleted, 0 failed.')).toBeVisible();
    await expect(table.getByText('No documents found')).toBeVisible();
    await expect(table.locator('tbody input[type="checkbox"]')).toHaveCount(0);
    await expect.poll(async () => collection.countDocuments({})).toBe(0);
  } finally {
    await collection.drop().catch(() => undefined);
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
