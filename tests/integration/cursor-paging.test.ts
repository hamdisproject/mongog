/**
 * S4: cursor-handle pagination against real mongod — no toArray() anywhere,
 * correct hasMore transitions, TTL expiry, prev window, explicit close.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { ExecutionEngine } from '../../src/query-runtime/engine/execute.js';
import { CursorRegistry } from '../../src/query-runtime/registry/cursors.js';
import type { EngineEvent } from '../../src/shared/domain/index.js';
import { parseEjson } from '../../src/shared/ejson/index.js';
import { getStandaloneUri, newClient, stopAll } from './helpers/mongo.js';

const TOTAL = 2500;

describe('cursor pagination', () => {
  let client: MongoClient;
  let registry: CursorRegistry;
  let engine: ExecutionEngine;
  let firstCursorId: string;

  beforeAll(async () => {
    const uri = await getStandaloneUri();
    client = await newClient(uri);
    registry = new CursorRegistry();
    engine = new ExecutionEngine(registry);

    const coll = client.db('mongog_test').collection('big');
    // Batched inserts for speed.
    for (let batch = 0; batch < TOTAL / 500; batch++) {
      await coll.insertMany(
        Array.from({ length: 500 }, (_, i) => ({ n: batch * 500 + i, pad: 'x'.repeat(20) })),
      );
    }

    const events: EngineEvent[] = [];
    const handle = engine.execute(
      {
        client,
        database: 'mongog_test',
        source: 'db.collection("big").find({}).sort({ n: 1 });',
        mode: 'query',
        pageSize: 50,
        registry,
        owner: { connectionId: 'paging' },
      },
      (e) => events.push(e),
    );
    await handle.promise;
    const result = events.find((e) => e.type === 'result');
    if (result?.type !== 'result' || result.result.kind !== 'documents') {
      throw new Error('expected documents result');
    }
    expect(result.result.documents).toHaveLength(50);
    expect(result.result.hasMore).toBe(true);
    firstCursorId = result.result.cursorId;
  }, 120_000);

  afterAll(async () => {
    await registry.dispose();
    await stopAll();
  });

  it('walks 2500 documents in 50-document pages, then reports hasMore=false', async () => {
    let count = 50; // first page already consumed
    let page = await registry.fetchNext(firstCursorId, 50);
    count += page.documents.length;
    while (page.hasMore) {
      page = await registry.fetchNext(firstCursorId, 50);
      count += page.documents.length;
      if (count > TOTAL + 100) throw new Error('runaway pagination');
    }
    expect(count).toBe(TOTAL);
    expect(page.hasMore).toBe(false);
  }, 120_000);

  it('supports fetchPrev from the retained window after paging forward', async () => {
    const cursorId = await openSmallCursor(); // engine pre-fetches page 0
    const p1 = await registry.fetchNext(cursorId, 5);
    expect(p1.pageIndex).toBe(1);
    const p2 = await registry.fetchNext(cursorId, 5);
    expect(p2.pageIndex).toBe(2);
    const prev = registry.fetchPrev(cursorId);
    expect(prev.pageIndex).toBe(1);
    expect(prev.documents).toHaveLength(5);
    const forward = await registry.fetchNext(cursorId, 5);
    expect(forward.pageIndex).toBe(2);
    expect(forward.documents).toEqual(p2.documents);
    await registry.close(cursorId);
  });

  it('close() stops further paging with CursorNotFound', async () => {
    const cursorId = await openSmallCursor();
    await registry.close(cursorId);
    await expect(registry.fetchNext(cursorId, 5)).rejects.toMatchObject({
      category: 'CursorNotFound',
    });
  });

  it('idle TTL expires cursors automatically', async () => {
    const ttlRegistry = new CursorRegistry({ idleTimeoutMS: 50 });
    const cursor = client.db('mongog_test').collection('big').find({});
    const id = ttlRegistry.register(cursor, { connectionId: 'paging' }, 'mongog_test.big');
    await ttlRegistry.fetchNext(id, 5);
    await new Promise((r) => setTimeout(r, 120));
    expect(await ttlRegistry.closeIdle()).toBe(1);
    await expect(ttlRegistry.fetchNext(id, 5)).rejects.toMatchObject({
      category: 'CursorNotFound',
    });
    await ttlRegistry.dispose();
  });

  it('fetches a full BSON document only through its retained value handle', async () => {
    const fullRegistry = new CursorRegistry({
      pageBudget: { maxDocBytes: 256, maxPageBytes: 8 * 1024 },
      maxFullValueBytes: 2 * 1024 * 1024,
    });
    const collection = client.db('mongog_test').collection('full_values');
    await collection.insertOne({ marker: 'full-value', payload: 'z'.repeat(300_000) });
    const cursor = collection.find({ marker: 'full-value' });
    const cursorId = fullRegistry.register(
      cursor,
      { connectionId: 'paging', tabId: 'full-value-tab' },
      'mongog_test.full_values',
    );

    const page = await fullRegistry.fetchNext(cursorId, 5);
    const preview = page.documents[0]!;
    expect(preview.truncated).toBe(true);
    expect(preview.fullValueId).toBeTruthy();

    const full = fullRegistry.fetchFullValue(cursorId, preview.fullValueId!);
    const parsed = parseEjson<{ marker: string; payload: string }>(full);
    expect(full.truncated).toBe(false);
    expect(parsed.marker).toBe('full-value');
    expect(parsed.payload).toHaveLength(300_000);
    await fullRegistry.dispose();
  });

  it('closeAllForOwner cleans cursors on tab close/disconnect', async () => {
    const before = registry.size; // firstCursorId etc. still registered
    const a = client.db('mongog_test').collection('big').find({});
    const b = client.db('mongog_test').collection('big').find({});
    registry.register(a, { connectionId: 'paging', tabId: 'tab-1' }, 'x.y');
    registry.register(b, { connectionId: 'paging', tabId: 'tab-2' }, 'x.y');
    expect(registry.size).toBe(before + 2);
    expect(await registry.closeAllForOwner({ connectionId: 'paging', tabId: 'tab-1' })).toBe(1);
    expect(registry.size).toBe(before + 1);
    // Remaining: everything owned by the 'paging' connection (b + firstCursorId...).
    expect(await registry.closeAllForOwner({ connectionId: 'paging' })).toBe(before + 1);
    expect(registry.size).toBe(0);
  });

  async function openSmallCursor(): Promise<string> {
    const events: EngineEvent[] = [];
    const handle = engine.execute(
      {
        client,
        database: 'mongog_test',
        source: 'db.collection("big").find({}).limit(30);',
        mode: 'query',
        pageSize: 5,
        registry,
        owner: { connectionId: 'paging' },
      },
      (e) => events.push(e),
    );
    await handle.promise;
    const result = events.find((e) => e.type === 'result');
    if (result?.type !== 'result' || result.result.kind !== 'documents') {
      throw new Error('expected documents result');
    }
    return result.result.cursorId;
  }
});
