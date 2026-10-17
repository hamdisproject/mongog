import { expect, test } from '../fixtures/mongog-test.js';
import { createE2EHarness } from '../helpers/harness.js';
import { setQueryEditorValue } from '../helpers/ui.js';

test('Query editor completions favour MongoDB and hide browser and rare BSON globals', async ({ mongog }) => {
  test.setTimeout(120_000);
  const { launch, closeApplication, mongoUri, databaseName } = createE2EHarness(mongog);

  try {
    const page = await launch();
    await page.getByRole('button', { name: 'New Connection', exact: true }).click();
    await page.getByLabel('Connection name').fill('Completions E2E');
    await page.getByLabel('Connection URI').fill(mongoUri);
    await page.getByLabel('Default database').fill(databaseName);
    await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
    await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Open global search' }).click();
    await page.getByLabel('Search databases and collections').fill('inventory');
    await page.getByRole('option', { name: /inventory Completions E2E/ }).click();
    await page.getByRole('button', { name: 'Query', exact: true }).click();

    const suggestions = page.locator('.suggest-widget.visible');
    const suggestFor = async (source: string) => {
      await setQueryEditorValue(page, source);
      await page.keyboard.press('Control+Space');
    };

    await test.step('MongoDB shell globals rank first', async () => {
      await suggestFor('d');
      await expect(suggestions.locator('.monaco-list-row').first()).toContainText('db', { timeout: 15_000 });
      await page.keyboard.press('Escape');
    });

    await test.step('Browser and rare BSON globals are not suggested', async () => {
      const widget = page.locator('.suggest-widget');
      for (const [prefix, hidden] of [['docu', /document/i], ['HTMLEl', /HTMLElement/], ['BinD', /BinData/]] as const) {
        await suggestFor(prefix);
        // Wait for the answer (rows or the empty message) before asserting absence.
        await expect(widget.locator('.monaco-list-row').first().or(widget.getByText('No suggestions.')))
          .toBeVisible({ timeout: 15_000 });
        await expect(widget).not.toContainText(hidden);
        await page.keyboard.press('Escape');
      }
    });

    await test.step('Common BSON helpers are still suggested for values', async () => {
      await suggestFor('db.collection("inventory").find({ sku: Obj');
      await expect(suggestions).toContainText('ObjectId', { timeout: 15_000 });
      await page.keyboard.press('Escape');
    });
  } finally {
    await closeApplication();
  }
});
