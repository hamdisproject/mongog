import { EJSON } from 'bson';
import { MongoClient, ObjectId } from 'mongodb';

import { expect, test } from '../fixtures/mongog-test.js';
import { setEditorValueByLabel } from '../helpers/ui.js';
import {
  allEditorBsonDocumentSource,
  editorBsonCases,
} from '../../fixtures/bson-editor-corpus.js';

const canonical = (value: unknown) => EJSON.stringify(value, undefined, 0, { relaxed: false });

test('document editor inserts a real ObjectId and keeps _id immutable', async ({ mongog }) => {
  test.setTimeout(120_000);
  const client = new MongoClient(mongog.mongoUri);
  await client.connect();
  const collection = client.db(mongog.databaseName).collection<{
    _id: ObjectId | string;
    marker: string;
    roundTrip?: boolean;
    [field: string]: unknown;
  }>('typed_id_e2e');
  await client.db(mongog.databaseName).createCollection('typed_id_e2e');

  try {
    const { application, page } = await mongog.launch();
    await page.getByRole('button', { name: 'New Connection', exact: true }).click();
    await page.getByLabel('Connection name').fill('Typed ObjectId E2E');
    await page.getByLabel('Connection URI').fill(mongog.mongoUri);
    await page.getByLabel('Default database').fill(mongog.databaseName);
    await page.getByRole('button', { name: 'Test, Save & Connect' }).click();
    await expect(page.getByText('Connection tested, saved, and connected.'))
      .toBeVisible({ timeout: 30_000 });

    const explorer = page.getByRole('navigation', { name: 'Connection explorer' });
    await explorer.getByRole('treeitem', { name: 'Connection Typed ObjectId E2E' }).press('ArrowRight');
    await explorer.getByRole('treeitem', { name: `Database ${mongog.databaseName}` }).press('ArrowRight');
    await page.getByTitle(`Open ${mongog.databaseName}.typed_id_e2e`).click();

    const id = '507f1f77bcf86cd799439011';
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const panel = page.getByTestId('document-panel');
    await setEditorValueByLabel(
      page,
      application,
      'Document BSON editor',
      allEditorBsonDocumentSource(id, 'marker: "typed"'),
    );
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Document inserted.')).toBeVisible();

    await expect.poll(async () => (
      await collection.findOne({ _id: new ObjectId(id) })
    )?.marker).toBe('typed');
    const inserted = await collection.findOne(
      { _id: new ObjectId(id) },
      { promoteValues: false },
    );
    expectCorpus(inserted);
    await expect(collection.findOne({ _id: id })).resolves.toBeNull();

    const table = page.getByTestId('collection-documents-table');
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table).toContainText(`ObjectId("${id}")`);
    await table.locator('tbody tr').click();
    await panel.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.getByLabel('Document BSON editor');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await application.evaluate(({ clipboard }) => clipboard.writeText(''));
    await editor.focus();
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.press(`${modifier}+C`);
    await expect.poll(() => application.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain(`ObjectId("${id}")`);
    const rendered = await application.evaluate(({ clipboard }) => clipboard.readText());
    expect(rendered).toContain('Decimal128("1234.5678")');
    expect(rendered).toContain('Long("9223372036854775807")');
    expect(rendered).toContain('BinData(128, "qrvM")');
    expect(rendered).toContain('BSONSymbol("legacy")');
    const updatedMarker = rendered.replace('marker: "typed"', 'marker: "updated"');
    const closingBrace = updatedMarker.trimEnd().lastIndexOf('}');
    expect(closingBrace).toBeGreaterThan(0);
    const edited = `${updatedMarker.trimEnd().slice(0, closingBrace).trimEnd()},\n  roundTrip: true\n}`;
    await setEditorValueByLabel(page, application, 'Document BSON editor', edited);
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Document updated.')).toBeVisible();
    await expect.poll(async () => (
      await collection.findOne({ _id: new ObjectId(id) })
    )?.marker).toBe('updated');
    const roundTripped = await collection.findOne(
      { _id: new ObjectId(id) },
      { promoteValues: false },
    );
    expect(roundTripped?.roundTrip).toBe(true);
    expectCorpus(roundTripped);

    await table.locator('tbody tr').click();
    await panel.getByRole('button', { name: 'Edit', exact: true }).click();
    await setEditorValueByLabel(
      page,
      application,
      'Document BSON editor',
      '{ _id: ObjectId("507f1f77bcf86cd799439012"), marker: "invalid" }',
    );
    await expect(panel.getByRole('alert')).toContainText('MongoDB does not allow changing');
    await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(collection.findOne({ _id: new ObjectId(id) })).resolves.toMatchObject({
      marker: 'updated',
    });
  } finally {
    await client.close(true);
  }
});

function expectCorpus(document: Record<string, unknown> | null): void {
  expect(document).not.toBeNull();
  for (const { field, expected } of editorBsonCases) {
    expect(canonical(document?.[field]), `BSON field ${field}`).toBe(canonical(expected));
  }
}
