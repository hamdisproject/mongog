import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { ExecutionEngine } from '../../../src/query-runtime/engine/execute.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import { parseEjson } from '../../../src/shared/ejson/index.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';
import { executeAndCollect } from './helpers/execution.js';

const suite = useMongoIntegrationSuite('engine bson context');
const DATABASE = suite.databaseName;
const SIBLING_DATABASE = `${DATABASE}_sibling`;

describe('ExecutionEngine (real mongod)', () => {
  let client: MongoClient;
  let registry: CursorRegistry;
  let engine: ExecutionEngine;

  beforeAll(async () => {
    client = await suite.newClient(suite.standaloneUri);
    registry = new CursorRegistry();
    engine = new ExecutionEngine(registry);
    await client.db(DATABASE).collection('users').insertMany([
      { name: 'Ada', active: true, createdAt: new Date('2026-01-01') },
      { name: 'Grace', active: false, createdAt: new Date('2026-01-02') },
      { name: 'Linus', active: true, createdAt: new Date('2026-01-03') },
    ]);
  }, 120_000);

  afterAll(async () => {
    await registry.dispose();
  });

  const run = (source: string, extra: Partial<Parameters<ExecutionEngine['execute']>[0]> = {}) => {
    return executeAndCollect(engine, client, registry, DATABASE, source, extra);
  };

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

  it('exposes callable mongosh BSON globals backed by real bson values', async () => {
    const c = await run(`({
      oid: ObjectId("507f1f77bcf86cd799439011"),
      date: ISODate("2026-01-01T00:00:00.000Z"),
      int: NumberInt(42),
      long: NumberLong("9223372036854775807"),
      decimal: NumberDecimal("125.50"),
      binary: BinData(0, "AQID"),
      uuid: UUID("00112233-4455-6677-8899-aabbccddeeff"),
      regex: BSONRegExp("^bike", "i"),
      timestamp: Timestamp({ t: 1700000000, i: 1 }),
      min: MinKey(),
      max: MaxKey()
    });`);
    expect(c.finished?.status).toBe('completed');
    expect(c.results[0]?.result.kind).toBe('scalar');
    if (c.results[0]?.result.kind === 'scalar') {
      const canonical = c.results[0].result.value.ejson;
      expect(canonical).toContain('$oid');
      expect(canonical).toContain('$date');
      expect(canonical).toContain('$numberLong');
      expect(canonical).toContain('$numberDecimal');
      expect(canonical).toContain('$binary');
      expect(canonical).toContain('$regularExpression');
      expect(canonical).toContain('$timestamp');
    }
  });

  it('use() rebinds db and print/printjson produce console results', async () => {
    const c = await run(`
use("${DATABASE}");
db.collection("users").countDocuments({});
print("hello", { ok: 1 });
printjson({ nested: [1, 2, 3] });
`);
    expect(c.finished?.status).toBe('completed');
    const consoles = c.events.filter((e) => e.type === 'console');
    expect(consoles.length).toBe(2);
    expect(c.results[0]!.result.kind).toBe('scalar');
  });

  it('supports Mongo shell-style getSiblingDB without rebinding the active db', async () => {
    await client.db(SIBLING_DATABASE).collection('items').insertMany([{ n: 1 }, { n: 2 }]);
    const c = await run(`
await db.getSiblingDB("${SIBLING_DATABASE}").collection("items").countDocuments({});
db.databaseName;
`);
    expect(c.finished?.status).toBe('completed');
    expect(c.results).toHaveLength(2);
    if (c.results[0]!.result.kind === 'scalar') {
      expect(Number(parseEjson(c.results[0]!.result.value))).toBe(2);
    } else {
      expect.unreachable('expected scalar count');
    }
    if (c.results[1]!.result.kind === 'scalar') {
      expect(parseEjson(c.results[1]!.result.value)).toBe(DATABASE);
    } else {
      expect.unreachable('expected active database name');
    }
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
});
