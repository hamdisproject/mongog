/**
 * ADR-0014: Documents pages are independent skip/limit queries. Pages must be
 * complete and non-overlapping, survive elapsed timeouts, and leave only a
 * page handle (no live server cursor) behind.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { findCollectionDocuments } from '../../../src/query-runtime/collection/operations.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import type { CollectionDocumentsPage } from '../../../src/shared/domain/index.js';
import { parseEjson } from '../../../src/shared/ejson/index.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';

const suite = useMongoIntegrationSuite('skip paging');
const DATABASE = suite.databaseName;
const owner = { connectionId: 'skip-paging', tabId: 'documents' };

describe('Documents skip/limit pages', () => {
  let client: MongoClient;
  let registry: CursorRegistry;

  beforeAll(async () => {
    client = await suite.newClient(suite.standaloneUri);
    registry = new CursorRegistry();
    // Only three distinct sort keys: without an _id tiebreaker, MongoDB may
    // order ties differently between page queries.
    await client.db(DATABASE).collection<{ _id: number; group: number }>('ties').insertMany(
      Array.from({ length: 137 }, (_, n) => ({ _id: n, group: n % 3 })),
    );
  });

  afterAll(async () => {
    await registry.dispose();
  });

  const page = (skip: number, extra: { sortEjson?: string; timeoutMS?: number } = {}, target = client) =>
    findCollectionDocuments(target, registry, {
      database: DATABASE,
      collection: 'ties',
      owner,
      filterEjson: '{}',
      pageSize: 20,
      skip,
      ...extra,
    });

  const ids = (result: CollectionDocumentsPage) =>
    result.documents.map((envelope) => Number(parseEjson<{ _id: number }>(envelope)._id));

  const readAll = async (sortEjson?: string) => {
    const seen: number[] = [];
    let current = await page(0, sortEjson ? { sortEjson } : {});
    seen.push(...ids(current));
    while (current.hasMore) {
      current = await page(current.skip + current.documents.length, sortEjson ? { sortEjson } : {});
      seen.push(...ids(current));
    }
    return seen;
  };

  it('returns every document exactly once across pages of tied sort keys', async () => {
    const seen = await readAll('{"group": 1}');
    expect(seen).toHaveLength(137);
    expect(new Set(seen).size).toBe(137);
    // Within one group, _id breaks the tie in ascending order.
    expect(seen.slice(0, 3)).toEqual([0, 3, 6]);
  });

  it('orders by _id when no sort is given and reports the logical page index', async () => {
    const third = await page(40);
    expect(ids(third)).toEqual(Array.from({ length: 20 }, (_, n) => 40 + n));
    expect(third).toMatchObject({ pageIndex: 2, skip: 40, hasMore: true });
    expect(await readAll()).toEqual(Array.from({ length: 137 }, (_, n) => n));
  });

  it('returns an empty last page past the end without hasMore', async () => {
    const past = await page(500);
    expect(past.documents).toEqual([]);
    expect(past.hasMore).toBe(false);
    const last = await page(120);
    expect(ids(last)).toHaveLength(17);
    expect(last.hasMore).toBe(false);
  });

  it('keeps paging after the CSOT budget elapsed because no server cursor is kept', async () => {
    const timed = await suite.newClient(suite.standaloneUri, { timeoutMS: 500 });
    const first = await page(0, { timeoutMS: 500 }, timed);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const second = await page(first.skip + first.documents.length, { timeoutMS: 500 }, timed);
    expect(ids(second)).toEqual(Array.from({ length: 20 }, (_, n) => 20 + n));
  }, 10_000);

  it('leaves a page-only handle: export snapshot works, further paging does not', async () => {
    const result = await page(20);
    expect(registry.snapshotCurrentPage(result.cursorId).documents).toHaveLength(20);
    await expect(registry.fetchNext(result.cursorId, 20)).rejects.toMatchObject({ category: 'CursorNotFound' });

    // Loading another page for the same tab releases the previous handle.
    await page(40);
    expect(() => registry.snapshotCurrentPage(result.cursorId)).toThrow(/closed or expired/);
  });
});
