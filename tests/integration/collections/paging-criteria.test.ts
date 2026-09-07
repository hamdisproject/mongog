import { Decimal128, Int32, ObjectId } from 'bson';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
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
import { parseEjson } from '../../../src/shared/ejson/index.js';
import { isAppError, MongoGCancellationError } from '../../../src/shared/errors/index.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';

const suite = useMongoIntegrationSuite('collection paging criteria');
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

  it('aborts a delayed find, closes its cursor, and keeps the client usable', async () => {
    const collection = client!.db(DATABASE).collection('cancelled_find');
    await collection.insertMany(Array.from({ length: 20 }, (_, n) => ({ n })));
    await client!.db('admin').command({
      configureFailPoint: 'failCommand',
      mode: { times: 1 },
      data: {
        appName: suite.appName,
        failCommands: ['find'],
        blockConnection: true,
        blockTimeMS: 10_000,
      },
    });

    const controller = new AbortController();
    let cursorId: string | null = null;
    const pending = findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'cancelled_find',
      owner: { connectionId: 'phase3', tabId: 'cancelled-find-tab' },
      filterEjson: '{}',
      pageSize: 10,
      signal: controller.signal,
      onCursorRegistered: (id) => { cursorId = id; },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort(new MongoGCancellationError('Fetch cancelled'));
    await expect(pending).rejects.toMatchObject({ name: 'MongoGCancelled' });
    expect(cursorId).not.toBeNull();
    await expect(registry!.fetchNext(cursorId!, 10)).rejects.toMatchObject({
      category: 'CursorNotFound',
    });
    await expect(client!.db('admin').command({ ping: 1 })).resolves.toMatchObject({ ok: 1 });
  }, 20_000);

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
});
