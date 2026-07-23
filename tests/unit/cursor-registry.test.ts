import { describe, expect, it, vi } from 'vitest';
import {
  CursorRegistry,
  type CursorLike,
} from '../../src/query-runtime/registry/cursors.js';

/** Deterministic fake cursor over an in-memory array. */
function fakeCursor(docs: unknown[]): CursorLike & { closedCount: number } {
  let i = 0;
  const c = {
    closed: false,
    closedCount: 0,
    async next() {
      if (c.closed) return null;
      return i < docs.length ? docs[i++] : null;
    },
    async hasNext() {
      return !c.closed && i < docs.length;
    },
    async close() {
      c.closed = true;
      c.closedCount += 1;
    },
  };
  return c;
}

const owner = { connectionId: 'c1', tabId: 't1' };
const docs = Array.from({ length: 120 }, (_, i) => ({ _id: i, v: `doc-${i}` }));

describe('CursorRegistry', () => {
  it('pages forward without materializing the full result set', async () => {
    const reg = new CursorRegistry();
    const cursor = fakeCursor(docs);
    const id = reg.register(cursor, owner, 'db.coll');

    const p1 = await reg.fetchNext(id, 50);
    expect(p1.documents).toHaveLength(50);
    expect(p1.hasMore).toBe(true);
    expect(p1.pageIndex).toBe(0);

    const p2 = await reg.fetchNext(id, 50);
    expect(p2.hasMore).toBe(true);

    const p3 = await reg.fetchNext(id, 50);
    expect(p3.documents).toHaveLength(20);
    expect(p3.hasMore).toBe(false);
    expect(cursor.closedCount).toBe(0); // still open until closed/expired
    await reg.dispose();
  });

  it('serves previous pages from the retained window', async () => {
    const reg = new CursorRegistry();
    const id = reg.register(fakeCursor(docs), owner, 'db.coll');
    const p1 = await reg.fetchNext(id, 50);
    await reg.fetchNext(id, 50);
    const prev = reg.fetchPrev(id);
    expect(prev.pageIndex).toBe(0);
    expect(prev.documents).toEqual(p1.documents);
    await reg.dispose();
  });

  it('caps the retained page window', async () => {
    const reg = new CursorRegistry({ maxRetainedPages: 3 });
    const id = reg.register(fakeCursor(docs), owner, 'db.coll');
    for (let i = 0; i < 5; i++) await reg.fetchNext(id, 10);
    // Only the last 3 pages are retained; fetchPrev twice then fails.
    reg.fetchPrev(id);
    reg.fetchPrev(id);
    expect(() => reg.fetchPrev(id)).toThrow(/No previous page/);
    await reg.dispose();
  });

  it('close() actually closes the underlying cursor', async () => {
    const reg = new CursorRegistry();
    const cursor = fakeCursor(docs);
    const id = reg.register(cursor, owner, 'db.coll');
    await reg.close(id);
    expect(cursor.closedCount).toBe(1);
    await expect(reg.fetchNext(id, 10)).rejects.toThrow(/closed or expired/);
  });

  it('expires idle cursors via TTL', async () => {
    let now = 1_000;
    const reg = new CursorRegistry({ idleTimeoutMS: 100, now: () => now });
    const cursor = fakeCursor(docs);
    const id = reg.register(cursor, owner, 'db.coll');
    await reg.fetchNext(id, 10);
    now += 50;
    expect(await reg.closeIdle()).toBe(0);
    now += 200;
    expect(await reg.closeIdle()).toBe(1);
    expect(cursor.closedCount).toBe(1);
  });

  it('closeAllForOwner cleans up per tab/connection', async () => {
    const reg = new CursorRegistry();
    const a = fakeCursor(docs);
    const b = fakeCursor(docs);
    const c = fakeCursor(docs);
    reg.register(a, { connectionId: 'c1', tabId: 't1' }, 'x.y');
    reg.register(b, { connectionId: 'c1', tabId: 't2' }, 'x.y');
    reg.register(c, { connectionId: 'c2', tabId: 't1' }, 'x.y');

    expect(await reg.closeAllForOwner({ connectionId: 'c1', tabId: 't1' })).toBe(1);
    expect(a.closedCount).toBe(1);
    expect(b.closedCount).toBe(0);
    expect(await reg.closeAllForOwner({ connectionId: 'c1' })).toBe(1);
    expect(b.closedCount).toBe(1);
    expect(c.closedCount).toBe(0);
    await reg.dispose();
  });

  it('rejects unknown cursors with CursorNotFound', async () => {
    const reg = new CursorRegistry();
    await expect(reg.fetchNext('nope', 10)).rejects.toMatchObject({ category: 'CursorNotFound' });
  });

  it('page byte budget cuts pages WITHOUT losing documents', async () => {
    const reg = new CursorRegistry({
      pageBudget: { maxDocBytes: 300, maxPageBytes: 500 },
    });
    const big = Array.from({ length: 20 }, (_, i) => ({ i, pad: 'x'.repeat(150) }));
    const id = reg.register(fakeCursor(big), owner, 'db.coll');

    const seen = new Set<number>();
    let page = await reg.fetchNext(id, 20);
    expect(page.documents.length).toBeLessThan(20); // budget actually cut
    expect(page.hasMore).toBe(true);
    for (;;) {
      for (const env of page.documents) {
        seen.add(JSON.parse(env.ejson).i as number);
      }
      if (!page.hasMore) break;
      page = await reg.fetchNext(id, 20);
    }
    expect(seen.size).toBe(20); // every document arrived exactly once
    await reg.dispose();
  });

  it('fetches a retained full value for a truncated document', async () => {
    const reg = new CursorRegistry({
      pageBudget: { maxDocBytes: 100, maxPageBytes: 1_000 },
      maxFullValueBytes: 10_000,
    });
    const original = { _id: 1, payload: 'x'.repeat(500) };
    const id = reg.register(fakeCursor([original]), owner, 'db.coll');

    const page = await reg.fetchNext(id, 10);
    const preview = page.documents[0]!;
    expect(preview.truncated).toBe(true);
    expect(preview.fullValueId).toBeTruthy();

    const full = reg.fetchFullValue(id, preview.fullValueId!);
    expect(full.truncated).toBe(false);
    expect(JSON.parse(full.ejson)).toEqual({
      _id: { $numberInt: '1' },
      payload: original.payload,
    });
    await reg.dispose();
  });

  it('does not advertise full values larger than the retention budget', async () => {
    const reg = new CursorRegistry({
      pageBudget: { maxDocBytes: 100, maxPageBytes: 1_000 },
      maxFullValueBytes: 200,
    });
    const id = reg.register(
      fakeCursor([{ _id: 1, payload: 'x'.repeat(500) }]),
      owner,
      'db.coll',
    );

    const page = await reg.fetchNext(id, 10);
    expect(page.documents[0]?.truncated).toBe(true);
    expect(page.documents[0]?.fullValueId).toBeUndefined();
    await reg.dispose();
  });

  it('startSweeper/stopSweeper manage the interval', () => {
    const reg = new CursorRegistry({ idleTimeoutMS: 0 });
    vi.useFakeTimers();
    try {
      reg.startSweeper(10);
      reg.stopSweeper();
    } finally {
      vi.useRealTimers();
    }
  });
});
