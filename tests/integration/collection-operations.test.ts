import { EJSON, Int32, ObjectId } from 'bson';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import {
  deleteCollectionDocument,
  findCollectionDocuments,
  insertCollectionDocument,
  replaceCollectionDocument,
} from '../../src/query-runtime/collection/operations.js';
import { CursorRegistry } from '../../src/query-runtime/registry/cursors.js';
import { parseEjson, serializeToEjson } from '../../src/shared/ejson/index.js';
import { getStandaloneUri, newClient, stopAll } from './helpers/mongo.js';

const DATABASE = 'mongog_phase3';

describe('collection browser operations', () => {
  let client: MongoClient | undefined;
  let registry: CursorRegistry | undefined;

  beforeAll(async () => {
    client = await newClient(await getStandaloneUri());
    registry = new CursorRegistry();
  }, 120_000);

  afterAll(async () => {
    await registry?.dispose();
    await client?.close();
    await stopAll();
  });

  it('pages the complete collection without imposing a one-page limit', async () => {
    const collection = client!.db(DATABASE).collection('paging');
    await collection.insertMany(Array.from({ length: 125 }, (_, n) => ({ n })));

    const first = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'paging',
      owner: { connectionId: 'phase3', tabId: 'paging-tab' },
      filterEjson: '{}',
      sortEjson: '{"n": 1}',
      pageSize: 25,
    });
    expect(first.documents).toHaveLength(25);
    expect(first.hasMore).toBe(true);
    expect(parseEjson<{ n: Int32 }>(first.documents[0]!).n.valueOf()).toBe(0);

    let count = first.documents.length;
    let page = await registry!.fetchNext(first.cursorId, 25);
    count += page.documents.length;
    while (page.hasMore) {
      page = await registry!.fetchNext(first.cursorId, 25);
      count += page.documents.length;
    }
    expect(count).toBe(125);
    expect(page.pageIndex).toBe(4);
  });

  it('applies safe object-literal filter, sort, and projection in the runtime', async () => {
    const collection = client!.db(DATABASE).collection('criteria');
    await collection.insertMany([
      { bikeid: 17827, rank: 1, active: true, hidden: 'a' },
      { bikeid: 17827, rank: 3, active: true, hidden: 'b' },
      { bikeid: 99, rank: 2, active: false, hidden: 'c' },
    ]);

    const page = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'criteria',
      owner: { connectionId: 'phase3', tabId: 'criteria-tab' },
      filterEjson: "{ /* sampled id */ bikeid: 17827, active: true, }",
      sortEjson: '{ rank: -1, }',
      projectionEjson: "{ rank: 1, 'active': 1 }",
      pageSize: 10,
    });
    const documents = page.documents.map((envelope) => parseEjson<Record<string, unknown>>(envelope));
    expect(documents.map((document) => (document.rank as Int32).valueOf())).toEqual([3, 1]);
    expect(documents.every((document) => !Object.hasOwn(document, 'hidden'))).toBe(true);
  });

  it('rejects executable criteria before they reach MongoDB', async () => {
    await expect(findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'criteria',
      owner: { connectionId: 'phase3', tabId: 'unsafe-criteria-tab' },
      filterEjson: '{ bikeid: getBikeId() }',
      pageSize: 10,
    })).rejects.toMatchObject({ category: 'Validation' });
  });

  it('replaces a BSON-rich document while preserving its immutable _id', async () => {
    const id = new ObjectId();
    const inserted = await insertCollectionDocument(client!, {
      database: DATABASE,
      collection: 'mutations',
      documentEjson: EJSON.stringify({ _id: id, value: 1 }, undefined, 0, { relaxed: false }),
    });
    expect(parseEjson<ObjectId>(inserted.insertedId!).equals(id)).toBe(true);

    const original = await client!.db(DATABASE).collection('mutations').findOne({ _id: id });
    const replacement = { ...original, value: 2, nested: { enabled: true } };
    const result = await replaceCollectionDocument(client!, {
      database: DATABASE,
      collection: 'mutations',
      originalDocumentEjson: serializeToEjson(original).ejson,
      documentEjson: serializeToEjson(replacement).ejson,
    });
    expect(result).toMatchObject({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });
    await expect(client!.db(DATABASE).collection('mutations').findOne({ _id: id }))
      .resolves.toMatchObject({ value: 2, nested: { enabled: true } });
  });

  it('rejects stale replacements instead of overwriting a concurrent change', async () => {
    const collection = client!.db(DATABASE).collection('stale');
    const { insertedId } = await collection.insertOne({ value: 'original' });
    const original = await collection.findOne({ _id: insertedId });
    await collection.updateOne({ _id: insertedId }, { $set: { value: 'concurrent' } });

    await expect(replaceCollectionDocument(client!, {
      database: DATABASE,
      collection: 'stale',
      originalDocumentEjson: serializeToEjson(original).ejson,
      documentEjson: serializeToEjson({ ...original, value: 'mine' }).ejson,
    })).rejects.toMatchObject({ category: 'StaleDocument' });
    await expect(collection.findOne({ _id: insertedId })).resolves.toMatchObject({ value: 'concurrent' });
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
    await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'owner_cleanup',
      owner,
      filterEjson: '{}',
      pageSize: 2,
    });
    await expect(registry!.fetchNext(first.cursorId, 2)).rejects.toMatchObject({
      category: 'CursorNotFound',
    });
  });
});
