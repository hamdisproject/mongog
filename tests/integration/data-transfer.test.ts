import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EJSON, ObjectId } from 'bson';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Document, MongoClient } from 'mongodb';
import { CopySourceManager } from '../../src/query-runtime/data-transfer/copy-source.js';
import { FileImportManager } from '../../src/query-runtime/data-transfer/file-import.js';
import { writeTransferBatch } from '../../src/query-runtime/data-transfer/write.js';
import type { DataJobProgressEvent } from '../../src/shared/domain/index.js';
import { getStandaloneUri, newClient, stopAll } from './helpers/mongo.js';

describe('streaming data transfer', () => {
  let client: MongoClient;
  let source: CopySourceManager;
  let tempDirectory: string;

  beforeAll(async () => {
    client = await newClient(await getStandaloneUri());
    source = new CopySourceManager();
    tempDirectory = await mkdtemp(join(tmpdir(), 'mongog-transfer-test-'));
  }, 120_000);

  afterAll(async () => {
    await source.dispose();
    await rm(tempDirectory, { recursive: true, force: true });
    await client.close();
    await stopAll();
  });

  it('copies filtered BSON documents without modifying the source', async () => {
    const sourceCollection = client.db('transfer_source').collection('orders');
    await sourceCollection.insertMany([
      { _id: new ObjectId(), status: 'active', nested: { tags: ['a', 'b'] } },
      { _id: new ObjectId(), status: 'inactive', nested: { tags: ['c'] } },
      { _id: new ObjectId(), status: 'active', nested: { tags: ['d'] } },
    ]);
    const before = await readCanonical(sourceCollection.find({}).sort({ _id: 1 }));

    const opened = source.open(client, 'transfer_source', 'orders', "{ status: 'active' }");
    for (;;) {
      const batch = await source.next(opened.cursorId);
      if (batch.documentsEjson.length) {
        await writeTransferBatch(client, {
          database: 'transfer_target',
          collection: 'orders_copy',
          documentsEjson: batch.documentsEjson,
          conflictMode: 'insert-stop',
          rowErrorPolicy: 'stop',
          upsertFields: ['_id'],
        });
      }
      if (!batch.hasMore) break;
    }

    expect(await client.db('transfer_target').collection('orders_copy').countDocuments()).toBe(2);
    expect(await readCanonical(sourceCollection.find({}).sort({ _id: 1 }))).toEqual(before);
  });

  it('streams RFC 4180 CSV rows, including BOM and multiline cells', async () => {
    const path = join(tempDirectory, 'products.csv');
    await writeFile(path, '\uFEFFsku,description,price\r\n001,"first\nline",1492.00\r\n002,second,8.50\r\n');
    let resolveTerminal!: (event: DataJobProgressEvent) => void;
    const terminal = new Promise<DataJobProgressEvent>((resolve) => { resolveTerminal = resolve; });
    const manager = new FileImportManager((event) => {
      if (['completed', 'failed', 'cancelled'].includes(event.status)) resolveTerminal(event);
    });
    const descriptor = await manager.inspect(path, '123e4567-e89b-12d3-a456-426614174000');
    const preview = await manager.preview(path, descriptor.token);
    expect(preview.rows[0]).toMatchObject({ sku: '001', description: 'first\nline' });
    expect(preview.suggestedMappings.find((mapping) => mapping.sourceColumn === 'sku')?.type).toBe('string');

    manager.start(client, 'target', [{
      path,
      fileName: descriptor.name,
      fileToken: descriptor.token,
      targetDatabase: 'transfer_target',
      targetCollection: 'csv_products',
      mappings: preview.suggestedMappings,
      emptyCellPolicy: 'omit',
      conflictMode: 'insert-stop',
      rowErrorPolicy: 'stop',
      upsertFields: ['_id'],
    }]);
    const event = await terminal;
    expect(event.status).toBe('completed');
    expect(event.inserted).toBe(2);
    expect(await client.db('transfer_target').collection('csv_products').countDocuments()).toBe(2);
    await manager.dispose();
  });

  it('applies skip, replace and merge conflict policies only on the target', async () => {
    const target = client.db('transfer_target').collection('conflicts');
    const id = new ObjectId();
    await target.insertOne({ _id: id, keep: 'target-only', value: 1 });
    const duplicate = EJSON.stringify({ _id: id, value: 2 }, undefined, 0, { relaxed: false });
    const freshId = new ObjectId();
    const fresh = EJSON.stringify({ _id: freshId, value: 3 }, undefined, 0, { relaxed: false });

    const skipped = await writeTransferBatch(client, {
      database: 'transfer_target', collection: 'conflicts', documentsEjson: [duplicate, fresh],
      conflictMode: 'insert-skip', rowErrorPolicy: 'stop', upsertFields: ['_id'],
    });
    expect(skipped.inserted).toBe(1);
    expect(skipped.skipped).toBe(1);

    await writeTransferBatch(client, {
      database: 'transfer_target', collection: 'conflicts', documentsEjson: [duplicate],
      conflictMode: 'merge-upsert', rowErrorPolicy: 'stop', upsertFields: ['_id'],
    });
    expect(await target.findOne({ _id: id })).toMatchObject({ keep: 'target-only', value: 2 });

    await writeTransferBatch(client, {
      database: 'transfer_target', collection: 'conflicts', documentsEjson: [duplicate],
      conflictMode: 'replace-upsert', rowErrorPolicy: 'stop', upsertFields: ['_id'],
    });
    expect(await target.findOne({ _id: id })).toEqual({ _id: id, value: 2 });
  });
});

async function readCanonical(cursor: { next(): Promise<Document | null>; close(): Promise<void> }): Promise<string[]> {
  const documents: string[] = [];
  try {
    for (;;) {
      const document = await cursor.next();
      if (!document) break;
      documents.push(EJSON.stringify(document, undefined, 0, { relaxed: false }));
    }
  } finally {
    await cursor.close();
  }
  return documents;
}
