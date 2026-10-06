import { MongoClient } from 'mongodb';

import { expect, test } from '../fixtures/mongog-test.js';
import { createE2EHarness } from '../helpers/harness.js';
import { setQueryEditorValue } from '../helpers/ui.js';

test('Query editor writes apply exactly once with Query timeout set to No limit', async ({ mongog }) => {
  const { launch, closeApplication, mongoUri, databaseName } = createE2EHarness(mongog);
  const page = await launch();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));

  await page.getByRole('button', { name: 'Open application settings' }).click();
  const queryTimeout = page.getByLabel('Query timeout');
  await queryTimeout.selectOption({ label: 'No limit' });
  await expect(queryTimeout).toHaveValue('0');
  await expect(page.getByText('Preferences are saved automatically.')).toBeVisible();

  await page.locator('[title^="welcome: Welcome"]').click();
  await page.getByRole('button', { name: 'New Connection', exact: true }).click();
  await page.getByLabel('Connection name').fill('Writes E2E');
  await page.getByLabel('Connection URI').fill(mongoUri);
  await page.getByLabel('Default database').fill(databaseName);
  await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
  await expect(page.getByText('Connection tested, saved, and connected.')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open global search' }).click();
  await page.getByLabel('Search databases and collections').fill('inventory');
  await page.getByRole('option', { name: /inventory Writes E2E/ }).click();
  await page.getByRole('button', { name: 'Query', exact: true }).click();
  const results = page.getByTestId('query-results-region');

  // Each run's summary differs from the previous one, so stale output from the
  // prior run can never satisfy the next expectation.
  const runs: Array<[string, Array<RegExp | string>, string?]> = [
    ['db.collection("e2e_writes").insertMany([{ _id: 1, n: 1 }, { _id: 2, n: 2 }, { _id: 3, n: 3 }]);', [/insert/, /inserted: 3/]],
    ['db.collection("e2e_writes").updateMany({ n: { $gte: 2 } }, { $inc: { n: 10 } });', [/update/, /matched: 2/, /modified: 2/]],
    ['db.collection("e2e_writes").replaceOne({ _id: 3 }, { n: 30, replaced: true });', [/update/, /matched: 1/, /modified: 1/]],
    ['db.collection("e2e_writes").bulkWrite([{ insertOne: { document: { _id: 4, n: 4 } } }, { deleteOne: { filter: { _id: 1 } } }]);', [/bulk/, /inserted: 1/, /deleted: 1/]],
    ['db.collection("e2e_writes").deleteOne({ _id: 4 });', [/delete/, /deleted: 1/], 'bulk'],
  ];
  for (const [source, expected, stale] of runs) {
    await setQueryEditorValue(page, source);
    await page.getByRole('button', { name: /^Run / }).click();
    if (stale) await expect(results).not.toContainText(stale);
    for (const pattern of expected) await expect(results).toContainText(pattern);
  }

  const client = new MongoClient(mongoUri);
  try {
    await expect.poll(() => client.db(databaseName).collection<{ _id: number }>('e2e_writes').find({}).sort({ _id: 1 }).toArray())
      .toEqual([{ _id: 2, n: 12 }, { _id: 3, n: 30, replaced: true }]);
  } finally {
    await client.close();
  }
  expect(errors).toEqual([]);
  await closeApplication();
});
