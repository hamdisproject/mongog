import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { ExecutionEngine } from '../../../src/query-runtime/engine/execute.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';
import { executeAndCollect } from './helpers/execution.js';

const suite = useMongoIntegrationSuite('engine policy errors');
const DATABASE = suite.databaseName;

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

  it.each([
    `const op = "insert" + "One"; await db.collection("users")[op]({ bypass: true });`,
    `const remove = db.collection("users").deleteMany; await remove({ name: "Ada" });`,
    `const key = "inse" + "rt"; await db.command({ [key]: "users", documents: [{ bypass: true }] });`,
    `const stage = "$" + "merge"; await db.collection("users").aggregate([{ [stage]: { into: "users_copy" } }]).toArray();`,
  ])('blocks runtime read-only bypasses without mutating data', async (source) => {
    const before = await client.db(DATABASE).collection('users').countDocuments({});
    const c = await run(source, { readOnly: true });
    expect(c.finished?.status).toBe('failed');
    expect(c.errors[0]!.category).toBe('ReadOnlyProtection');
    expect(await client.db(DATABASE).collection('users').countDocuments({})).toBe(before);
    expect(await client.db(DATABASE).collection('users').countDocuments({ bypass: true })).toBe(0);
  });

  it('blocks writes from a client created through trusted require', async () => {
    const source = `
const { MongoClient } = require("mongodb");
const host = client.options.hosts[0].toString();
const extra = new MongoClient("mongodb://" + host);
try {
  await extra.connect();
  const operation = "insert" + "One";
  await extra.db(${JSON.stringify(DATABASE)}).collection("users")[operation]({ bypass: true });
} finally {
  await extra.close();
}
`;
    const c = await run(source, { mode: 'trusted', readOnly: true });
    expect(c.finished?.status).toBe('failed');
    expect(c.errors[0]?.category).toBe('ReadOnlyProtection');
    expect(await client.db(DATABASE).collection('users').countDocuments({ bypass: true })).toBe(0);
  });

  it('keeps ordinary reads working through the runtime guard', async () => {
    const c = await run('await db.collection("users").countDocuments({ active: true });', { readOnly: true });
    expect(c.finished?.status).toBe('completed');
    expect(c.results[0]?.result.kind).toBe('scalar');
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
});
