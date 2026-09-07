import { Decimal128, Int32, ObjectId } from 'bson';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bulkDeleteCollectionDocuments,
  countCollectionDocuments,
  deleteCollectionDocument,
  dropCollection,
  dropDatabase,
  findCollectionDocuments,
  insertCollectionDocument,
  renameCollection,
  replaceCollectionDocument,
} from '../../../src/query-runtime/collection/operations.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import { parseEjson, serializeToEjson } from '../../../src/shared/ejson/index.js';
import { isAppError } from '../../../src/shared/errors/index.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';

const suite = useMongoIntegrationSuite('collection delete lifecycle');
const DATABASE = suite.databaseName;

describe('collection browser operations', () => {
  let client: MongoClient;
  let registry: CursorRegistry;

  beforeAll(async () => {
    client = await suite.newClient(suite.standaloneUri);
    registry = new CursorRegistry();
  }, 120_000);

  afterAll(async () => {
    await registry.dispose();
  });

  it('deletes the exact loaded version and reports a missing document', async () => {
    const collection = client!.db(DATABASE).collection('deletes');
    const { insertedId } = await collection.insertOne({ value: 'delete-me' });
    const original = await collection.findOne({ _id: insertedId });
    const originalEjson = serializeToEjson(original).ejson;

    await expect(deleteCollectionDocument(client!, {
      database: DATABASE,
      collection: 'deletes',
      originalDocumentEjson: originalEjson,
    })).resolves.toMatchObject({ acknowledged: true, deletedCount: 1 });

    await expect(deleteCollectionDocument(client!, {
      database: DATABASE,
      collection: 'deletes',
      originalDocumentEjson: originalEjson,
    })).rejects.toMatchObject({ category: 'NotFound' });
  });

  it('bulk deletes selected document versions and preserves result order', async () => {
    const collection = client!.db(DATABASE).collection('bulk_deletes');
    await collection.deleteMany({});
    await collection.insertMany([{ slot: 1 }, { slot: 2 }, { slot: 3 }]);
    const originals = await collection.find({}).sort({ slot: 1 }).toArray();

    const result = await bulkDeleteCollectionDocuments(client!, {
      database: DATABASE,
      collection: 'bulk_deletes',
      originalDocumentsEjson: originals.map((document) => serializeToEjson(document).ejson),
    });
    expect(result).toEqual({
      requestedCount: 3,
      deletedCount: 3,
      failedCount: 0,
      items: [
        { index: 0, status: 'success' },
        { index: 1, status: 'success' },
        { index: 2, status: 'success' },
      ],
    });
    await expect(collection.countDocuments({})).resolves.toBe(0);
  });

  it('continues bulk deletes and reports stale and missing documents per row', async () => {
    const collection = client!.db(DATABASE).collection('bulk_delete_conflicts');
    await collection.deleteMany({});
    await collection.insertMany([{ slot: 1 }, { slot: 2 }, { slot: 3 }]);
    const originals = await collection.find({}).sort({ slot: 1 }).toArray();
    await collection.updateOne({ _id: originals[0]!._id }, { $set: { concurrent: true } });
    await collection.deleteOne({ _id: originals[1]!._id });

    const result = await bulkDeleteCollectionDocuments(client!, {
      database: DATABASE,
      collection: 'bulk_delete_conflicts',
      originalDocumentsEjson: originals.map((document) => serializeToEjson(document).ejson),
    });
    expect(result).toMatchObject({ requestedCount: 3, deletedCount: 1, failedCount: 2 });
    expect(result.items[0]).toMatchObject({ status: 'error', error: { category: 'StaleDocument' } });
    expect(result.items[1]).toMatchObject({ status: 'error', error: { category: 'NotFound' } });
    expect(result.items[2]).toEqual({ index: 2, status: 'success' });
    await expect(collection.findOne({ _id: originals[0]!._id }))
      .resolves.toMatchObject({ concurrent: true });
    await expect(collection.findOne({ _id: originals[2]!._id })).resolves.toBeNull();
  });

  it('continues bulk deletes after one driver command error', async () => {
    const appName = 'mongog-bulk-delete-driver-error';
    const isolatedClient = new MongoClient(suite.standaloneUri, {
      appName,
      maxPoolSize: 1,
      retryWrites: false,
    });
    await isolatedClient.connect();
    const collection = isolatedClient.db(DATABASE).collection('bulk_delete_driver_error');
    await collection.deleteMany({});
    await collection.insertMany([{ slot: 1 }, { slot: 2 }, { slot: 3 }]);
    const originals = await collection.find({}).sort({ slot: 1 }).toArray();
    await client!.db('admin').command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: {
        failCommands: ['delete'],
        appName,
        blockConnection: true,
        blockTimeMS: 100,
        errorCode: 121,
      },
    });
    try {
      const result = await bulkDeleteCollectionDocuments(isolatedClient, {
        database: DATABASE,
        collection: 'bulk_delete_driver_error',
        originalDocumentsEjson: originals.map((document) => serializeToEjson(document).ejson),
      });
      expect(result).toMatchObject({ requestedCount: 3, deletedCount: 2, failedCount: 1 });
      expect(result.items.filter((item) => item.status === 'error')).toHaveLength(1);
      expect(result.items.filter((item) => item.status === 'success')).toHaveLength(2);
      await expect(collection.countDocuments({})).resolves.toBe(1);
    } finally {
      await client!.db('admin').command({ configureFailPoint: 'failCommand', mode: 'off' });
      await isolatedClient.close();
    }
  });

  it('closes the previous cursor when the same tab refreshes', async () => {
    const collection = client!.db(DATABASE).collection('owner_cleanup');
    await collection.insertMany(Array.from({ length: 5 }, (_, value) => ({ value })));
    const owner = { connectionId: 'phase3', tabId: 'same-tab' };
    const first = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'owner_cleanup',
      owner,
      filterEjson: '{}',
      pageSize: 2,
    });
    const refreshed = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'owner_cleanup',
      owner,
      filterEjson: '{}',
      pageSize: 3,
    });
    expect(refreshed.documents).toHaveLength(3);
    expect(refreshed.pageSize).toBe(3);
    expect(refreshed.pageIndex).toBe(0);
    await expect(registry!.fetchNext(first.cursorId, 2)).rejects.toMatchObject({
      category: 'CursorNotFound',
    });
  });
});
