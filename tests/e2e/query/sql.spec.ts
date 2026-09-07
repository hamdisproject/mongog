import type { Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { expect, test, type MongoGTestContext } from '../fixtures/mongog-test.js';
import { createE2EHarness } from '../helpers/harness.js';

async function createConnection(
  page: Page,
  mongog: MongoGTestContext,
  name: string,
  readOnly = false,
): Promise<void> {
  await page.getByRole('button', { name: 'New Connection', exact: true }).click();
  await page.getByLabel('Connection name').fill(name);
  await page.getByLabel('Connection URI').fill(mongog.mongoUri);
  await page.getByLabel('Default database').fill(mongog.databaseName);
  if (readOnly) await page.getByText('Protect this connection as read-only').click();
  await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
  await expect(page.getByText('Connection tested, saved, and connected.'))
    .toBeVisible({ timeout: 30_000 });
}

async function openStandaloneSql(page: Page, profileName: string, databaseName: string): Promise<void> {
  await page.locator('[title^="New SQL tab"]').click();
  await page.getByTestId('sql-workspace').getByLabel('Connection').selectOption({ label: profileName });
  await expect(page.getByTestId('sql-workspace').getByLabel('Database')).toHaveValue(databaseName);
}

async function setSql(page: Page, value: string): Promise<void> {
  await page.getByTestId('sql-editor-surface').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(value);
}

async function sqlText(page: Page): Promise<string> {
  return page.getByTestId('sql-editor-surface').evaluate((surface) => (
    (surface.querySelector('.view-lines')?.textContent ?? '').replace(/\s+/gu, ' ')
  ));
}

test('packaged SQL runs, pages, confirms full writes and persists saved SQL tabs', async ({ mongog }) => {
  const harness = createE2EHarness(mongog);
  const client = new MongoClient(mongog.mongoUri);
  await client.connect();
  await client.db(mongog.databaseName).collection('inventory').insertMany(
    Array.from({ length: 58 }, (_, index) => ({ sku: `bulk-${index}`, quantity: index + 10 })),
  );

  let page = await harness.launch();
  await createConnection(page, mongog, 'SQL E2E');
  await openStandaloneSql(page, 'SQL E2E', mongog.databaseName);

  const selectSource = 'SELECT * FROM inventory ORDER BY quantity ASC LIMIT 60;';
  await setSql(page, selectSource);
  await expect(page.getByText(/find · inventory/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/\.find\(/)).toBeVisible();
  await page.getByRole('button', { name: /Run SQL/ }).click();
  const results = page.getByTestId('sql-results-region');
  await expect(results.getByText('Statement 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(results.getByText('50 document(s)', { exact: true })).toBeVisible();
  await results.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(results.getByText('Page 2', { exact: true })).toBeVisible();

  await setSql(page, 'DELETE FROM inventory LIMIT 1;');
  await expect(page.getByText('ORDER BY/LIMIT on DELETE is not supported.'))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Run SQL/ })).toBeDisabled();
  expect(await client.db(mongog.databaseName).collection('inventory').countDocuments()).toBe(60);

  const fullUpdate = 'UPDATE inventory SET reviewed = true;';
  await setSql(page, fullUpdate);
  await expect(page.getByText(/updateMany · inventory · write/)).toBeVisible({ timeout: 15_000 });
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('atomic per document');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: /Run SQL/ }).click();
  await expect.poll(() => client.db(mongog.databaseName).collection('inventory')
    .countDocuments({ reviewed: true })).toBe(0);

  page.once('dialog', async (dialog) => dialog.accept());
  await page.getByRole('button', { name: /Run SQL/ }).click();
  await expect(results.getByText('matched: 60', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => client.db(mongog.databaseName).collection('inventory')
    .countDocuments({ reviewed: true })).toBe(60);

  await page.getByTestId('save-sql').click();
  const saveDialog = page.getByRole('dialog', { name: 'Save item' });
  await saveDialog.getByLabel('Saved item name').fill('E2E Saved SQL');
  await saveDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved · E2E Saved SQL')).toBeVisible();
  await expect.poll(() => sqlText(page)).toContain(fullUpdate);

  await harness.closeApplication();
  page = await harness.launch();
  await expect(page.getByText('Welcome back')).toBeVisible();
  const restoredSqlTab = page.locator('[data-tab-kind="sql"]');
  await expect(restoredSqlTab).toHaveCount(1);
  await restoredSqlTab.click();
  await expect(restoredSqlTab).toHaveAttribute('data-tab-active', 'true');
  await expect.poll(() => sqlText(page)).toContain(fullUpdate);
  const explorer = page.getByRole('navigation', { name: 'Connection explorer' });
  const profile = explorer.getByRole('treeitem', { name: 'Connection SQL E2E' });
  await profile.focus();
  await page.keyboard.press('ArrowRight');
  const savedRoot = explorer.getByRole('treeitem', { name: 'Saved for SQL E2E' });
  await savedRoot.focus();
  await page.keyboard.press('ArrowRight');
  const savedSql = explorer.getByRole('treeitem', { name: 'Saved Tab Template E2E Saved SQL' });
  await expect(savedSql).toBeVisible();
  await savedSql.click();
  await expect(page.locator('[data-tab-kind="sql"][data-tab-active="true"]')).toHaveCount(1);
  await expect.poll(() => sqlText(page)).toContain(fullUpdate);

  await client.close(true);
});

test('packaged SQL read-only profile permits reads and rejects trusted-channel writes', async ({ mongog }) => {
  const harness = createE2EHarness(mongog);
  const page = await harness.launch();
  await createConnection(page, mongog, 'Read Only SQL E2E', true);
  await openStandaloneSql(page, 'Read Only SQL E2E', mongog.databaseName);

  await setSql(page, 'SELECT sku FROM inventory ORDER BY sku LIMIT 2;');
  await expect(page.getByText(/aggregate · inventory/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Run SQL/ }).click();
  await expect(page.getByTestId('sql-results-region').getByText('Statement 1', { exact: true }))
    .toBeVisible({ timeout: 30_000 });

  const blockedMessage = await page.evaluate(async ({ database }) => {
    const connectionId = (document.querySelector('[data-testid="sql-workspace"] select[aria-label="Connection"]') as HTMLSelectElement).value;
    try {
      await window.mongog.query.executeSql({
        connectionId,
        database,
        source: 'UPDATE inventory SET quantity = 999 WHERE sku = \'alpha\';',
      });
      return '';
    } catch (error) {
      return error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);
    }
  }, { database: mongog.databaseName });
  expect(blockedMessage).toContain('read-only');

  const client = new MongoClient(mongog.mongoUri);
  await client.connect();
  expect((await client.db(mongog.databaseName).collection('inventory')
    .findOne({ sku: 'alpha' }))?.quantity).toBe(3);
  await client.close(true);

  await setSql(page, 'UPDATE inventory SET quantity = 999 WHERE sku = \'alpha\';');
  await expect(page.getByRole('button', { name: /Run SQL/ })).toBeDisabled();
});

test('collection SQL reports parse ranges, cancels and restores its own source', async ({ mongog }) => {
  const harness = createE2EHarness(mongog);
  let page = await harness.launch();
  await createConnection(page, mongog, 'Collection SQL E2E');

  await page.getByRole('button', { name: 'Open global search' }).click();
  const search = page.getByLabel('Search databases and collections');
  await search.fill('inventory');
  const collectionResult = page.getByRole('option', { name: /inventory Collection SQL E2E/ });
  await expect(collectionResult).toBeVisible({ timeout: 15_000 });
  await collectionResult.click();
  await page.getByRole('button', { name: 'SQL', exact: true }).click();
  const sqlWorkspace = page.getByTestId('sql-workspace');
  await expect(sqlWorkspace.getByLabel('Connection')).toBeDisabled();
  await expect(sqlWorkspace.getByLabel('Database')).toBeDisabled();

  await setSql(page, 'SELECT FROM inventory;');
  const previewError = sqlWorkspace.locator('[role="alert"]:not(.monaco-alert)');
  await expect(previewError).toBeVisible({ timeout: 15_000 });
  await expect(previewError).not.toHaveText('');
  await expect(sqlWorkspace.locator('.squiggly-error')).not.toHaveCount(0);
  await expect(sqlWorkspace.getByRole('button', { name: /Run SQL/ })).toBeDisabled();

  const finalSource = 'SELECT * FROM inventory ORDER BY sku LIMIT 2;';
  await setSql(page, finalSource);
  await expect(page.getByText(/find · inventory/)).toBeVisible({ timeout: 15_000 });

  const failPointClient = new MongoClient(mongog.mongoUri);
  await failPointClient.connect();
  try {
    await failPointClient.db('admin').command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: { failCommands: ['find'], blockConnection: true, blockTimeMS: 10_000 },
    });
    await sqlWorkspace.getByRole('button', { name: /Run SQL/ }).click();
    await expect(page.getByTestId('loading-overlay')).toBeVisible();
    await sqlWorkspace.getByRole('button', { name: 'Cancel (Esc)', exact: true }).click();
    await expect(page.getByTestId('loading-overlay')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('sql-results-region').getByText('cancelled', { exact: true }).first())
      .toBeVisible();
  } finally {
    await failPointClient.db('admin').command({
      configureFailPoint: 'failCommand',
      mode: 'off',
    }).catch(() => undefined);
    await failPointClient.close(true);
  }

  await harness.closeApplication();
  page = await harness.launch();
  await expect(page.getByText('Welcome back')).toBeVisible();
  const restoredCollection = page.locator('[data-tab-kind="collection"]');
  await expect(restoredCollection).toHaveCount(1);
  await restoredCollection.click();
  await expect(page.getByRole('button', { name: 'SQL', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => sqlText(page)).toContain(finalSource);
});
