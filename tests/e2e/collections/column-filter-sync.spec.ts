import { MongoClient } from 'mongodb';

import { expect, test } from '../fixtures/mongog-test.js';
import { createE2EHarness } from '../helpers/harness.js';
import { setMonacoValue } from '../helpers/ui.js';

test('Documents column filters and the Filter editor stay in sync both ways', async ({ mongog }) => {
  test.setTimeout(150_000);
  const { launch, closeApplication, mongoUri, databaseName } = createE2EHarness(mongog);
  const client = new MongoClient(mongoUri);
  await client.connect();
  await client.db(databaseName).collection('sync_e2e').insertMany([
    { name: 'alpha', quantity: 2, status: 'open' },
    { name: 'beta', quantity: 5, status: 'open' },
    { name: 'gamma', quantity: 9, status: 'closed' },
  ]);

  try {
    let page = await launch();
    await page.getByRole('button', { name: 'New Connection', exact: true }).click();
    await page.getByLabel('Connection name').fill('Sync E2E');
    await page.getByLabel('Connection URI').fill(mongoUri);
    await page.getByLabel('Default database').fill(databaseName);
    await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
    await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
    const explorer = page.getByRole('navigation', { name: 'Connection explorer' });
    await explorer.getByRole('treeitem', { name: 'Connection Sync E2E' }).press('ArrowRight');
    await explorer.getByRole('treeitem', { name: `Database ${databaseName}` }).press('ArrowRight');
    await page.getByTitle(`Open ${databaseName}.sync_e2e`).click();

    const rows = page.getByTestId('collection-documents-table').locator('tbody tr');
    const filterEditor = page.getByTestId('criteria-editor-filter');
    const apply = page.getByRole('button', { name: 'Apply', exact: true });
    await expect(rows).toHaveCount(3);

    await test.step('Column input writes into the Filter', async () => {
      await page.getByLabel('Filter quantity column').fill('> 4');
      await expect(filterEditor).toContainText('"quantity"');
      await expect(filterEditor).toContainText('$gt');
      await apply.click();
      await expect(rows).toHaveCount(2);
    });

    await test.step('Filter edits flow back into the column inputs', async () => {
      await setMonacoValue(page, 'Collection filter', '{ quantity: { $gt: 4 }, status: "open" }');
      await expect(page.getByLabel('Filter status column')).toHaveValue('open');
      await expect(page.getByLabel('Filter quantity column')).toHaveValue('> 4');
    });

    await test.step('Column edits keep conditions only the Filter can express', async () => {
      await setMonacoValue(
        page,
        'Collection filter',
        '{ $or: [{ status: "open" }, { quantity: 9 }], quantity: { $gt: 4 } }',
      );
      await expect(page.getByLabel('Filter status column')).toHaveValue('');
      await page.getByLabel('Filter name column').fill('beta');
      await expect(filterEditor).toContainText('$or');
      await expect(filterEditor).toContainText('"name"');
      await apply.click();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('beta');
    });

    await test.step('Column inputs are restored from the Filter after relaunch', async () => {
      await closeApplication();
      page = await launch();
      await page.locator('[data-tab-kind="collection"]').first().locator('[data-tab-select]').click();
      const surface = page.locator('[data-collection-surface]');
      await surface.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(page.getByTestId('collection-documents-table').locator('tbody tr')).toHaveCount(1);
      await expect(page.getByLabel('Filter name column')).toHaveValue('beta');
      await expect(page.getByLabel('Filter quantity column')).toHaveValue('> 4');
      await expect(page.getByLabel('Filter status column')).toHaveValue('');
    });
  } finally {
    await closeApplication();
    await client.close();
  }
});
