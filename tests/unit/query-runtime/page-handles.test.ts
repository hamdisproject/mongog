import { describe, expect, it } from 'vitest';
import { CursorRegistry, type CursorLike } from '../../../src/query-runtime/registry/cursors.js';
import { stablePageSort } from '../../../src/query-runtime/collection/operations.js';
import { connCollectionFindSchema, MAX_COLLECTION_SKIP } from '../../../src/shared/ipc/index.js';

function fakeCursor(docs: unknown[]): CursorLike & { closedCount: number } {
  let index = 0;
  const cursor = {
    closed: false,
    closedCount: 0,
    async next() {
      return !cursor.closed && index < docs.length ? docs[index++] : null;
    },
    async hasNext() {
      return !cursor.closed && index < docs.length;
    },
    async close() {
      cursor.closed = true;
      cursor.closedCount += 1;
    },
  };
  return cursor;
}

const owner = { connectionId: 'c1', tabId: 'documents' };

describe('Documents page handles (ADR-0014)', () => {
  it('closes the driver cursor but keeps the page for full values and export', async () => {
    const registry = new CursorRegistry({ pageBudget: { maxDocBytes: 64, maxPageBytes: 8 * 1024 * 1024 } });
    const cursor = fakeCursor([{ _id: 1, payload: 'x'.repeat(500) }, { _id: 2 }, { _id: 3 }]);
    const id = registry.register(cursor, owner, 'app.items');

    const page = await registry.fetchNext(id, 2);
    await registry.release(id);

    expect(cursor.closedCount).toBe(1);
    expect(page.hasMore).toBe(true);
    const truncated = page.documents[0]!;
    expect(truncated.truncated).toBe(true);
    expect(registry.fetchFullValue(id, truncated.fullValueId!).ejson).toContain('x'.repeat(500));
    expect(registry.snapshotCurrentPage(id).documents).toHaveLength(2);
    await expect(registry.fetchNext(id, 2)).rejects.toMatchObject({ category: 'CursorNotFound' });
    expect(() => registry.fetchPrev(id)).toThrow(/No previous page/);
  });

  it('expires released page handles with the normal idle timeout', async () => {
    let now = 0;
    const registry = new CursorRegistry({ idleTimeoutMS: 1_000, now: () => now });
    const id = registry.register(fakeCursor([{ _id: 1 }]), owner, 'app.items');
    await registry.fetchNext(id, 50);
    await registry.release(id);

    now = 2_000;
    expect(await registry.closeIdle()).toBe(1);
    expect(() => registry.snapshotCurrentPage(id)).toThrow(/closed or expired/);
  });
});

describe('stablePageSort', () => {
  it('orders by _id by default and breaks ties of user sorts with _id', () => {
    expect(stablePageSort(undefined)).toEqual({ _id: 1 });
    expect(stablePageSort({})).toEqual({ _id: 1 });
    expect(Object.entries(stablePageSort({ city: 1, age: -1 }) as Record<string, number>))
      .toEqual([['city', 1], ['age', -1], ['_id', 1]]);
  });

  it('keeps sorts that already include _id or use $natural unchanged', () => {
    expect(stablePageSort({ _id: -1, city: 1 })).toEqual({ _id: -1, city: 1 });
    expect(stablePageSort({ $natural: -1 })).toEqual({ $natural: -1 });
  });
});

describe('collection find IPC paging bounds', () => {
  const request = {
    connectionId: 'c1',
    database: 'app',
    collection: 'items',
    tabId: 'documents',
    operationId: '00000000-0000-4000-8000-000000000000',
    filterEjson: '{}',
    pageSize: 50,
  };

  it('accepts whole, non-negative offsets up to the documented limit', () => {
    expect(connCollectionFindSchema.parse(request).skip).toBeUndefined();
    expect(connCollectionFindSchema.parse({ ...request, skip: 0 }).skip).toBe(0);
    expect(connCollectionFindSchema.parse({ ...request, skip: MAX_COLLECTION_SKIP }).skip).toBe(MAX_COLLECTION_SKIP);
    for (const skip of [-1, 1.5, MAX_COLLECTION_SKIP + 1]) {
      expect(connCollectionFindSchema.safeParse({ ...request, skip }).success).toBe(false);
    }
  });
});
