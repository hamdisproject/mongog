import type { Locator, Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { expect, test } from '../fixtures/mongog-test.js';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function alphabetical(names: string[]): string[] {
  return [...names].sort((left, right) => (
    collator.compare(left, right) || (left === right ? 0 : left < right ? -1 : 1)
  ));
}

async function createConnection(page: Page, mongoUri: string, databaseName: string): Promise<void> {
  await page.getByRole('button', { name: 'New Connection', exact: true }).click();
  await page.getByLabel('Connection name').fill('Catalog Order E2E');
  await page.getByLabel('Connection URI').fill(mongoUri);
  await page.getByLabel('Default database').fill(databaseName);
  await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
  await expect(page.getByText('Connection tested, saved, and connected.'))
    .toBeVisible({ timeout: 30_000 });
}

async function ariaNames(root: Locator, prefix: string, candidates: string[]): Promise<string[]> {
  const labels = await root.locator(`[aria-label^="${prefix}"]`).evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('aria-label') ?? '')
  ));
  const candidateSet = new Set(candidates);
  return labels.map((label) => label.slice(prefix.length)).filter((name) => candidateSet.has(name));
}

async function optionNames(root: Locator, candidates: string[]): Promise<string[]> {
  const candidateSet = new Set(candidates);
  return (await root.locator('option').allTextContents()).filter((name) => candidateSet.has(name));
}

test('catalog order settings are independent, immediate, global, and persistent', async ({ mongog }) => {
  test.setTimeout(120_000);
  const suffix = mongog.databaseName.slice(-8);
  const databaseNames = [`order_z10_${suffix}`, `order_Alpha2_${suffix}`];
  const collectionNames = ['order_z10', 'order_Alpha2', 'order_alpha10'];
  const client = new MongoClient(mongog.mongoUri);
  await client.connect();

  try {
    for (const collection of collectionNames) {
      await client.db(mongog.databaseName).createCollection(collection);
    }
    for (const database of databaseNames) {
      await client.db(database).collection('seed').insertOne({ ready: true });
    }
    const rawDatabases = (await client.db('admin').admin().listDatabases({ nameOnly: true }))
      .databases.map(({ name }) => name).filter((name) => databaseNames.includes(name));
    const rawCollections = (await client.db(mongog.databaseName).listCollections({}, { nameOnly: true }).toArray())
      .map(({ name }) => name).filter((name) => collectionNames.includes(name));

    let { page } = await mongog.launch();
    await createConnection(page, mongog.mongoUri, mongog.databaseName);

    const explorer = page.getByRole('navigation', { name: 'Connection explorer' });
    const profile = explorer.getByRole('treeitem', { name: 'Connection Catalog Order E2E' });
    await profile.focus();
    await profile.press('ArrowRight');
    const profileTree = profile.locator('..');
    await expect(profileTree.getByRole('treeitem', { name: `Database ${mongog.databaseName}` }))
      .toBeVisible({ timeout: 15_000 });
    expect(await ariaNames(profileTree, 'Database ', databaseNames)).toEqual(alphabetical(databaseNames));

    const mainDatabase = profileTree.getByRole('treeitem', { name: `Database ${mongog.databaseName}` });
    await mainDatabase.focus();
    await mainDatabase.press('ArrowRight');
    await expect(profileTree.getByTitle(`Open ${mongog.databaseName}.order_z10`)).toBeVisible();
    expect(await ariaNames(profileTree, `Collection ${mongog.databaseName}.`, collectionNames))
      .toEqual(alphabetical(collectionNames));

    await page.getByTitle('New query tab').click();
    const queryEditor = page.getByTestId('query-editor');
    await queryEditor.getByLabel('Connection').selectOption({ label: 'Catalog Order E2E' });
    expect(await optionNames(queryEditor.getByLabel('Database'), databaseNames))
      .toEqual(alphabetical(databaseNames));

    await page.locator('[title^="New SQL tab"]').click();
    const sqlWorkspace = page.getByTestId('sql-workspace');
    await sqlWorkspace.getByLabel('Connection').selectOption({ label: 'Catalog Order E2E' });
    expect(await optionNames(sqlWorkspace.getByLabel('Database'), databaseNames))
      .toEqual(alphabetical(databaseNames));

    await page.getByRole('button', { name: 'Open global search' }).click();
    await page.getByLabel('Search databases and collections').fill(`order_ ${suffix}`);
    const paletteLabels = await page.getByRole('option').evaluateAll((options) => options.map((option) => (
      option.children.item(1)?.children.item(0)?.textContent ?? ''
    )));
    expect(paletteLabels.filter((label) => databaseNames.includes(label))).toEqual(alphabetical(databaseNames));
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Open application settings' }).click();
    const databaseDatabaseOrder = page.getByRole('radio', { name: 'Database order databases' });
    const collectionDatabaseOrder = page.getByRole('radio', { name: 'Database order collections' });
    await expect(page.getByRole('radio', { name: 'Alphabetical databases' }))
      .toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: 'Alphabetical collections' }))
      .toHaveAttribute('aria-checked', 'true');

    await databaseDatabaseOrder.click();
    await expect(databaseDatabaseOrder).toHaveAttribute('aria-checked', 'true');
    expect(await ariaNames(profileTree, 'Database ', databaseNames)).toEqual(rawDatabases);
    expect(await ariaNames(profileTree, `Collection ${mongog.databaseName}.`, collectionNames))
      .toEqual(alphabetical(collectionNames));

    await collectionDatabaseOrder.click();
    await expect(collectionDatabaseOrder).toHaveAttribute('aria-checked', 'true');
    expect(await ariaNames(profileTree, `Collection ${mongog.databaseName}.`, collectionNames))
      .toEqual(rawCollections);
    expect(await ariaNames(profileTree, 'Database ', databaseNames)).toEqual(rawDatabases);

    await mongog.close();
    ({ page } = await mongog.launch());
    await page.getByRole('button', { name: 'Open application settings' }).click();
    await expect(page.getByRole('radio', { name: 'Database order databases' }))
      .toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: 'Database order collections' }))
      .toHaveAttribute('aria-checked', 'true');
  } finally {
    for (const database of databaseNames) await client.db(database).dropDatabase().catch(() => undefined);
    await client.close(true);
  }
});
