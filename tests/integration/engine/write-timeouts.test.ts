/**
 * Writes under Settings → Query timeout. The runtime's MongoClient always has
 * a client-level CSOT default (30 s), while the script's `db` now carries the
 * execution budget. Every create/update/delete path must report the right
 * counts AND leave the right documents behind, for the default budget, "No
 * limit" (0) and a longer finite budget — including convenient transactions,
 * where the driver rejects conflicting operation-level timeoutMS values.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { ExecutionEngine } from '../../../src/query-runtime/engine/execute.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import { translateSql } from '../../../src/features/sql-translator/index.js';
import type { QueryResult } from '../../../src/shared/domain/index.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';
import { executeAndCollect } from './helpers/execution.js';

const suite = useMongoIntegrationSuite('write-timeouts');
const DATABASE = suite.databaseName;
// Same client-level default as src/query-runtime/index.ts `init`.
const RUNTIME_CLIENT_TIMEOUT_MS = 30_000;

const BUDGETS = [
  ['default (30 s)', undefined],
  ['No limit', 0],
  ['5 minutes', 5 * 60_000],
] as const;

type WriteResult = Extract<QueryResult, { kind: 'write' }>;
// Test documents use readable scalar ids instead of the driver's ObjectId default.
type TestDocument = { _id: number | string; [field: string]: unknown };

describe('writes under the query timeout (real replica set)', () => {
  let client: MongoClient;
  let control: MongoClient;
  let registry: CursorRegistry;
  let engine: ExecutionEngine;
  let sequence = 0;

  beforeAll(async () => {
    const uri = await suite.replicaSetUri;
    client = await suite.newClient(uri, { timeoutMS: RUNTIME_CLIENT_TIMEOUT_MS });
    control = await suite.newClient(uri);
    registry = new CursorRegistry();
    engine = new ExecutionEngine(registry);
  });

  afterAll(async () => {
    await registry.dispose();
  });

  const freshCollection = async () => {
    const name = `writes_${++sequence}`;
    await control.db(DATABASE).createCollection(name);
    return { name, collection: control.db(DATABASE).collection<TestDocument>(name) };
  };

  const run = (source: string, timeoutMS: number | undefined, extra = {}) => executeAndCollect(
    engine, client, registry, DATABASE, source,
    { ...(timeoutMS !== undefined ? { timeoutMS } : {}), ...extra },
  );

  const writes = (results: Array<{ result: QueryResult }>): WriteResult[] => results.map(({ result }) => {
    if (result.kind !== 'write') throw new Error(`expected write result, got ${result.kind}`);
    return result;
  });

  it.each(BUDGETS)('applies every CRUD statement exactly once with %s', async (_label, timeoutMS) => {
    const { name, collection } = await freshCollection();
    const c = `db.collection(${JSON.stringify(name)})`;
    const outcome = await run([
      `${c}.insertOne({ _id: 1, name: "a", n: 1 });`,
      `${c}.insertMany([{ _id: 2, n: 2 }, { _id: 3, n: 3 }]);`,
      `${c}.updateOne({ _id: 1 }, { $set: { name: "A" } });`,
      `${c}.updateMany({ n: { $gte: 2 } }, { $inc: { n: 10 } });`,
      `${c}.replaceOne({ _id: 3 }, { name: "C", n: 30 });`,
      `${c}.bulkWrite([{ insertOne: { document: { _id: 4 } } }, { deleteOne: { filter: { _id: 2 } } }]);`,
      `${c}.deleteOne({ _id: 4 });`,
      `${c}.deleteMany({ n: 30 });`,
      `${c}.updateOne({ _id: 9 }, { $set: { n: 9 } }, { upsert: true });`,
    ].join('\n'), timeoutMS);

    expect(outcome.errors).toEqual([]);
    expect(outcome.finished?.status).toBe('completed');
    expect(writes(outcome.results).map(({ op, insertedCount, matchedCount, modifiedCount, deletedCount, upsertedCount }) => ({
      op, insertedCount, matchedCount, modifiedCount, deletedCount, upsertedCount,
    }))).toEqual([
      { op: 'insert', insertedCount: 1 },
      { op: 'insert', insertedCount: 2 },
      { op: 'update', matchedCount: 1, modifiedCount: 1, upsertedCount: 0 },
      { op: 'update', matchedCount: 2, modifiedCount: 2, upsertedCount: 0 },
      { op: 'update', matchedCount: 1, modifiedCount: 1, upsertedCount: 0 },
      { op: 'bulk', insertedCount: 1, matchedCount: 0, modifiedCount: 0, deletedCount: 1, upsertedCount: 0 },
      { op: 'delete', deletedCount: 1 },
      { op: 'delete', deletedCount: 1 },
      { op: 'update', matchedCount: 0, modifiedCount: 0, upsertedCount: 1 },
    ].map((expected) => expect.objectContaining(expected)));
    await expect(collection.find({}).sort({ _id: 1 }).toArray()).resolves.toEqual([
      { _id: 1, name: 'A', n: 1 },
      { _id: 9, n: 9 },
    ]);
  });

  it.each(BUDGETS)('commits and aborts convenient transactions with %s', async (_label, timeoutMS) => {
    const { name, collection } = await freshCollection();
    await collection.insertMany([{ _id: 'A1', balance: 200 }, { _id: 'A2', balance: 0 }]);
    const c = `db.collection(${JSON.stringify(name)})`;
    const outcome = await run(`
const session = client.startSession();
try {
  await session.withTransaction(async () => {
    await ${c}.updateOne({ _id: "A1" }, { $inc: { balance: -100 } }, { session });
    await ${c}.updateOne({ _id: "A2" }, { $inc: { balance: 100 } }, { session });
    await ${c}.insertOne({ _id: "log1", amount: 100 }, { session });
  });
  await session.withTransaction(async () => {
    await ${c}.deleteOne({ _id: "log1" }, { session });
    await ${c}.updateOne({ _id: "A1" }, { $set: { balance: -1 } }, { session });
    throw new Error("rollback requested");
  }).catch((error) => console.log(error.message));
} finally {
  await session.endSession();
}
`, timeoutMS);

    expect(outcome.errors).toEqual([]);
    expect(outcome.finished?.status).toBe('completed');
    expect(JSON.stringify(outcome.events.filter((event) => event.type === 'console'))).toContain('rollback requested');
    await expect(collection.find({}).sort({ _id: 1 }).toArray()).resolves.toEqual([
      { _id: 'A1', balance: 100 },
      { _id: 'A2', balance: 100 },
      { _id: 'log1', amount: 100 },
    ]);
  });

  it.each(BUDGETS)('runs SQL INSERT, UPDATE and DELETE with %s', async (_label, timeoutMS) => {
    const { name, collection } = await freshCollection();
    const sql = async (statement: string) => {
      const outcome = await run(translateSql(statement).jsSource, timeoutMS);
      expect(outcome.errors).toEqual([]);
      expect(outcome.finished?.status).toBe('completed');
      return writes(outcome.results)[0];
    };

    await expect(sql(`INSERT INTO ${name} (sku, qty) VALUES ('a', 1), ('b', 2), ('c', 3)`))
      .resolves.toMatchObject({ insertedCount: 3 });
    await expect(sql(`UPDATE ${name} SET qty = 20 WHERE qty >= 2`))
      .resolves.toMatchObject({ matchedCount: 2, modifiedCount: 2 });
    await expect(sql(`DELETE FROM ${name} WHERE sku = 'a'`))
      .resolves.toMatchObject({ deletedCount: 1 });
    await expect(collection.find({}, { projection: { _id: 0 } }).sort({ sku: 1 }).toArray()).resolves.toEqual([
      { sku: 'b', qty: 20 },
      { sku: 'c', qty: 20 },
    ]);
  });

  it('keeps read-only protection on db, getSiblingDB() and use() with No limit', async () => {
    const { name, collection } = await freshCollection();
    await collection.insertOne({ _id: 1 });
    const attempts = [
      `db.collection(${JSON.stringify(name)}).insertOne({ _id: 2 });`,
      `db.getSiblingDB(${JSON.stringify(DATABASE)}).collection(${JSON.stringify(name)}).deleteMany({});`,
      `const other = use(${JSON.stringify(DATABASE)}); const remove = other.collection(${JSON.stringify(name)}).deleteMany; remove({});`,
    ];
    for (const source of attempts) {
      const outcome = await run(source, 0, { readOnly: true });
      expect(outcome.finished?.status).toBe('failed');
      expect(outcome.errors[0]?.category).toBe('ReadOnlyProtection');
    }
    await expect(collection.find({}).toArray()).resolves.toEqual([{ _id: 1 }]);
  });
});
