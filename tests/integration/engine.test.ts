/**
 * S2/S3: multi-statement execution against REAL mongod with the real driver.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { ExecutionEngine } from '../../src/query-runtime/engine/execute.js';
import { CursorRegistry } from '../../src/query-runtime/registry/cursors.js';
import type { EngineEvent, QueryResult } from '../../src/shared/domain/index.js';
import { getStandaloneUri, getReplSetUri, newClient, stopAll } from './helpers/mongo.js';
import { parseEjson } from '../../src/shared/ejson/index.js';

interface Collected {
  events: EngineEvent[];
  results: Array<{ index: number; result: QueryResult }>;
  errors: Array<{ index: number; category?: string; message: string }>;
  finished?: { status: string; durationMs: number };
}

function collect(events: EngineEvent[]): Collected {
  const c: Collected = { events, results: [], errors: [] };
  for (const e of events) {
    if (e.type === 'result') c.results.push({ index: e.index, result: e.result });
    if (e.type === 'statement-error') c.errors.push({ index: e.index, category: e.error.category, message: e.error.message });
    if (e.type === 'execution-finished') c.finished = { status: e.status, durationMs: e.durationMs };
  }
  return c;
}

describe('ExecutionEngine (real mongod)', () => {
  let client: MongoClient;
  let registry: CursorRegistry;
  let engine: ExecutionEngine;

  beforeAll(async () => {
    const uri = await getStandaloneUri();
    client = await newClient(uri);
    registry = new CursorRegistry();
    engine = new ExecutionEngine(registry);
    await client.db('mongog_test').collection('users').insertMany([
      { name: 'Ada', active: true, createdAt: new Date('2026-01-01') },
      { name: 'Grace', active: false, createdAt: new Date('2026-01-02') },
      { name: 'Linus', active: true, createdAt: new Date('2026-01-03') },
    ]);
  });

  afterAll(async () => {
    await registry.dispose();
    await stopAll();
  });

  const run = (source: string, extra: Partial<Parameters<ExecutionEngine['execute']>[0]> = {}) => {
    const events: EngineEvent[] = [];
    const handle = engine.execute(
      {
        client,
        database: 'mongog_test',
        source,
        mode: 'query',
        registry,
        owner: { connectionId: 'test' },
        ...extra,
      },
      (e) => events.push(e),
    );
    return handle.promise.then(() => collect(events));
  };

  it('captures one result per top-level expression (plan §8 example)', async () => {
    const c = await run(`
const users = db.collection("users");
users.find({ active: true }).limit(10);
await users.countDocuments({ active: true });
await users.updateMany({ active: false }, { $set: { archived: true } });
`);
    expect(c.finished?.status).toBe('completed');
    expect(c.results).toHaveLength(3);

    const [cursor, count, update] = c.results;
    expect(cursor!.index).toBe(1);
    expect(cursor!.result.kind).toBe('documents');
    if (cursor!.result.kind === 'documents') {
      expect(cursor!.result.documents).toHaveLength(2);
      expect(cursor!.result.cursorId).toBeTruthy();
    }

    expect(count!.result.kind).toBe('scalar');
    if (count!.result.kind === 'scalar') {
      // Canonical EJSON for driver Int32: { "$numberInt": "2" }
      expect(Number(parseEjson(count!.result.value))).toBe(2);
    }

    expect(update!.result.kind).toBe('write');
    if (update!.result.kind === 'write') {
      expect(update!.result.op).toBe('update');
      expect(update!.result.matchedCount).toBe(1);
      expect(update!.result.modifiedCount).toBe(1);
    }
    // The captured cursor must survive execution for interactive paging.
    expect(registry.size).toBeGreaterThan(0);
    const statementRanges = c.events.filter((e) => e.type === 'statement-started');
    expect(statementRanges.length).toBeGreaterThanOrEqual(3);
  });

  it('supports destructuring from the mongodb namespace (ObjectId)', async () => {
    const c = await run(`
const { ObjectId } = mongodb;
await db.collection("orders").findOne({ _id: new ObjectId("000000000000000000000000") });
`);
    expect(c.finished?.status).toBe('completed');
    expect(c.results[0]!.result.kind).toBe('scalar');
    if (c.results[0]!.result.kind === 'scalar') {
      expect(c.results[0]!.result.value.ejson).toBe('null');
    }
  });

  it('use() rebinds db and print/printjson produce console results', async () => {
    const c = await run(`
use("mongog_test");
db.collection("users").countDocuments({});
print("hello", { ok: 1 });
printjson({ nested: [1, 2, 3] });
`);
    expect(c.finished?.status).toBe('completed');
    const consoles = c.events.filter((e) => e.type === 'console');
    expect(consoles.length).toBe(2);
    expect(c.results[0]!.result.kind).toBe('scalar');
  });

  it('constructs GridFSBucket from the real driver', async () => {
    const c = await run(`
const bucket = new mongodb.GridFSBucket(db);
typeof bucket;
`);
    expect(c.finished?.status).toBe('completed');
    expect(c.results[0]!.result.kind).toBe('scalar');
    if (c.results[0]!.result.kind === 'scalar') {
      expect(c.results[0]!.result.value.ejson).toBe('"object"');
    }
  });

  it('attributes a runtime error to the failing statement and skips the rest', async () => {
    const c = await run(`
const users = db.collection("users");
await users.countDocuments({});
await users.thisMethodDoesNotExist({});
await users.countDocuments({});
`);
    expect(c.finished?.status).toBe('failed');
    expect(c.errors).toHaveLength(1);
    expect(c.errors[0]!.index).toBe(2);
    expect(c.errors[0]!.category).toBe('JavaScriptRuntime');
    const skipped = c.events.filter((e) => e.type === 'statement-skipped');
    expect(skipped.length).toBeGreaterThanOrEqual(1);
  });

  it('attributes errors inside declarations to the right statement', async () => {
    const c = await run(`
const x = 1;
const y = undefinedVariable + 1;
const z = 3;
`);
    expect(c.finished?.status).toBe('failed');
    expect(c.errors[0]!.index).toBe(1);
  });

  it('rejects require() in Query Mode', async () => {
    const c = await run('const fs = require("fs");');
    expect(c.finished?.status).toBe('failed');
    expect(c.errors[0]!.category).toBe('ModuleNotAllowed');
  });

  it('blocks writes when the connection is read-only', async () => {
    const c = await run('await db.collection("users").insertOne({ evil: true });', { readOnly: true });
    expect(c.finished?.status).toBe('failed');
    expect(c.errors[0]!.category).toBe('ReadOnlyProtection');
  });

  it('reports syntax errors as InvalidQuerySyntax (no naive splitting)', async () => {
    const c = await run('const = broken;;;');
    expect(c.finished?.status).toBe('failed');
    expect(c.errors[0]!.category).toBe('InvalidQuerySyntax');
  });

  it('Trusted Mode allows the mongodb/bson require allowlist', async () => {
    const c = await run(`
const { ObjectId } = require("mongodb");
new ObjectId().toHexString().length;
`, { mode: 'trusted' });
    expect(c.finished?.status).toBe('completed');
    expect(c.results[0]!.result.kind).toBe('scalar');
  });

  it('Trusted Mode still blocks non-allowlisted modules', async () => {
    const c = await run('require("fs");', { mode: 'trusted' });
    expect(c.finished?.status).toBe('failed');
    expect(c.errors[0]!.category).toBe('ModuleNotAllowed');
  });

  it('runs transactions on a replica set', async () => {
    const rsUri = await getReplSetUri();
    const rsClient = await newClient(rsUri);
    const rsRegistry = new CursorRegistry();
    const rsEngine = new ExecutionEngine(rsRegistry);
    const db = rsClient.db('mongog_test_rs');
    await db.collection('accounts').insertMany([
      { accountNo: 'A1', balance: 200 },
      { accountNo: 'A2', balance: 0 },
    ]);

    const events: EngineEvent[] = [];
    const handle = rsEngine.execute(
      {
        client: rsClient,
        database: 'mongog_test_rs',
        source: `
const session = client.startSession();
try {
  await session.withTransaction(async () => {
    await db.collection("accounts").updateOne({ accountNo: "A1" }, { $inc: { balance: -100 } }, { session });
    await db.collection("accounts").updateOne({ accountNo: "A2" }, { $inc: { balance: 100 } }, { session });
  });
} finally {
  await session.endSession();
}
(await db.collection("accounts").find({}).toArray()).map(a => a.balance).join(",");
`,
        mode: 'trusted',
        registry: rsRegistry,
        owner: { connectionId: 'rs' },
      },
      (e) => events.push(e),
    );
    await handle.promise;
    const c = collect(events);
    expect(c.finished?.status).toBe('completed');
    if (c.results[0]!.result.kind === 'scalar') {
      expect(c.results[0]!.result.value.ejson).toBe('"100,100"');
    } else {
      expect.unreachable('expected scalar result');
    }
    await rsRegistry.dispose();
    await rsClient.close(true);
  });
});
