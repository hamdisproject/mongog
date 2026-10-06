/**
 * A paged result must stay usable after the query timeout has elapsed: CSOT
 * applies per page fetch, not to the cursor's whole lifetime. Before the fix,
 * the first getMore after `timeoutMS` failed with MongoOperationTimeoutError.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { ExecutionEngine } from '../../../src/query-runtime/engine/execute.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';
import { executeAndCollect } from './helpers/execution.js';

const suite = useMongoIntegrationSuite('cursor-timeout');
const DATABASE = suite.databaseName;
const BUDGET_MS = 500;

describe('cursor paging after the CSOT budget elapsed', () => {
  let client: MongoClient;
  let registry: CursorRegistry;
  let engine: ExecutionEngine;

  beforeAll(async () => {
    client = await suite.newClient(suite.standaloneUri, { timeoutMS: BUDGET_MS });
    registry = new CursorRegistry();
    engine = new ExecutionEngine(registry);
    // 400 documents: the first batch holds 101, later pages require getMore.
    await client.db(DATABASE).collection('items').insertMany(Array.from({ length: 400 }, (_, n) => ({ n })));
  });

  afterAll(async () => {
    await registry.dispose();
  });

  const pageThroughAfterBudget = async (cursorId: string) => {
    await new Promise((resolve) => setTimeout(resolve, BUDGET_MS * 3));
    const seen: number[] = [];
    let page = await registry.fetchNext(cursorId, 50);
    seen.push(page.documents.length);
    while (page.hasMore) {
      page = await registry.fetchNext(cursorId, 50);
      seen.push(page.documents.length);
    }
    return seen;
  };

  it.each([
    ['find', 'db.collection("items").find({}).sort({ n: 1 });'],
    ['aggregate', 'db.collection("items").aggregate([{ $sort: { n: 1 } }]);'],
  ])('keeps a %s result from the query editor pageable', async (_label, source) => {
    const run = await executeAndCollect(engine, client, registry, DATABASE, source, { timeoutMS: BUDGET_MS, pageSize: 50 });
    const result = run.results[0]?.result;
    expect(run.errors).toEqual([]);
    expect(result?.kind).toBe('documents');
    if (result?.kind !== 'documents') return;

    const remaining = await pageThroughAfterBudget(result.cursorId);
    expect(remaining.reduce((sum, count) => sum + count, 50)).toBe(400);
  }, 15_000);

  it('keeps a cursor that inherits the client-level CSOT default pageable', async () => {
    const cursorId = registry.register(
      client.db(DATABASE).collection('items').find({}).sort({ n: 1 }),
      { connectionId: 'cursor-timeout' },
      `${DATABASE}.items`,
    );
    expect((await registry.fetchNext(cursorId, 50)).documents).toHaveLength(50);

    const remaining = await pageThroughAfterBudget(cursorId);
    expect(remaining.reduce((sum, count) => sum + count, 50)).toBe(400);
  }, 15_000);
});
