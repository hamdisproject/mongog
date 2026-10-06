import { MongoClient } from 'mongodb';

import { expect, test } from '../fixtures/mongog-test.js';
import { createE2EHarness } from '../helpers/harness.js';

// ADR-0014: Documents pages are independent skip/limit queries.
test('Documents paging moves, jumps and stays on the page after edits', async ({ mongog }) => {
  test.setTimeout(120_000);
  const { launch, closeApplication, mongoUri, databaseName } = createE2EHarness(mongog);
  const client = new MongoClient(mongoUri);
  await client.connect();
  const collection = client.db(databaseName).collection<{ _id: number; label: string }>('paging_e2e');
  await collection.insertMany(Array.from({ length: 60 }, (_, n) => ({ _id: n, label: `doc-${n}` })));

  try {
    const page = await launch();
    await page.getByRole('button', { name: 'New Connection', exact: true }).click();
    await page.getByLabel('Connection name').fill('Paging E2E');
    await page.getByLabel('Connection URI').fill(mongoUri);
    await page.getByLabel('Default database').fill(databaseName);
    await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
    await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
    const explorer = page.getByRole('navigation', { name: 'Connection explorer' });
    await explorer.getByRole('treeitem', { name: 'Connection Paging E2E' }).press('ArrowRight');
    await explorer.getByRole('treeitem', { name: `Database ${databaseName}` }).press('ArrowRight');
    await page.getByTitle(`Open ${databaseName}.paging_e2e`).click();

    const rows = page.getByTestId('collection-documents-table').locator('tbody tr');
    const next = page.getByRole('button', { name: 'Next', exact: true });
    const previous = page.getByRole('button', { name: 'Previous', exact: true });
    await page.getByLabel('Documents page size').selectOption('25');
    await expect(rows).toHaveCount(25);
    await expect(rows.first()).toContainText('doc-0');
    await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
    await expect(previous).toBeDisabled();

    await next.click();
    await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
    await expect(rows.first()).toContainText('doc-25');
    await expect(page.getByLabel('Select document row 26')).toBeVisible();

    await page.getByRole('button', { name: 'Calculate total document count' }).click();
    await expect(page.getByText('Total count: 60')).toBeVisible();
    await expect(page.getByText('of 3', { exact: true })).toBeVisible();

    const goTo = page.getByLabel('Go to page');
    await goTo.fill('3');
    await goTo.press('Enter');
    await expect(page.getByText('Page 3', { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toContainText('doc-50');
    await expect(next).toBeDisabled();

    await goTo.fill('9');
    await goTo.press('Enter');
    await expect(page.getByText('Enter a page number between 1 and 3.')).toBeVisible();
    await expect(page.getByText('Page 3', { exact: true })).toBeVisible();

    await previous.click();
    await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
    await expect(rows.first()).toContainText('doc-25');

    // Deleting a document reloads the same page instead of jumping to page 1.
    await page.getByLabel('Select document row 26').check();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete selected (1)' }).click();
    await expect.poll(() => collection.countDocuments({ _id: 25 })).toBe(0);
    await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
    await expect(rows.first()).toContainText('doc-26');
    await expect(rows).toHaveCount(25);
  } finally {
    await closeApplication();
    await client.close();
  }
});
