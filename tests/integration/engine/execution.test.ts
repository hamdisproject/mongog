import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { ExecutionEngine } from '../../../src/query-runtime/engine/execute.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import { parseEjson } from '../../../src/shared/ejson/index.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';
import { executeAndCollect } from './helpers/execution.js';

const suite = useMongoIntegrationSuite('engine execution');
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

  it.each(['query', 'trusted'] as const)('await-free reads, writes, helpers and callbacks in %s mode', async mode => {
    const c = await run(`
const users = db.collection("users");
const user = users.findOne({name:"Ada"});
const names = ["Ada", "Grace"].map(name => users.findOne({name}).name);
function activeCount() { return users.countDocuments({active:true}); }
const target = db.collection("implicit_" + "${mode}");
target.deleteMany({});
const inserted = target.insertOne({name:user.name});
const record = target.findOne({_id:inserted.insertedId});
if (activeCount() > 0) print(record.name);
({name:record.name, names, count:activeCount()});
`, { mode });
    expect(c.errors).toEqual([]);
    const last = c.results.at(-1)?.result;
    expect(last?.kind).toBe('scalar');
    if (last?.kind === 'scalar') {
      const value = parseEjson(last.value) as {name:string;names:string[];count:unknown};
      expect(value).toMatchObject({name:'Ada', names:['Ada','Grace']}); expect(Number(value.count)).toBe(2);
    }
    expect(c.events.some(event => event.type === 'console')).toBe(true);
  });

  it('iterates cursors without toArray and keeps returned cursors available for paging', async () => {
    const c = await run(`
const users=db.collection("users"); const names=[];
for(const user of users.find({}).sort({name:1})) names.push(users.findOne({_id:user._id}).name);
names;
users.find({}).sort({name:1});
`, { pageSize: 1 });
    expect(c.errors).toEqual([]);
    const names = c.results[0]?.result;
    if (names?.kind === 'scalar') expect(parseEjson(names.value)).toEqual(['Ada','Grace','Linus']);
    else expect.unreachable('expected names');
    const cursor = c.results[1]?.result;
    if (cursor?.kind === 'documents') {
      expect(cursor.documents).toHaveLength(1); expect(cursor.hasMore).toBe(true);
      expect((await registry.fetchNext(cursor.cursorId, 1)).documents).toHaveLength(1);
    } else expect.unreachable('expected paged cursor');
  });

  it('rejects asynchronous cursor.forEach callbacks with an actionable message', async () => {
    const c = await run('db.collection("users").find({}).forEach(user => { db.collection("users").findOne({_id:user._id}); });');
    expect(c.finished?.status).toBe('failed');
    expect(c.errors[0]?.message).toContain('for...of');
  });

  it('uses original policy and selected statement ranges for implicit awaits', async () => {
    const blocked = await run('function write() { db.collection("users").insertOne({}); } write();', {readOnly:true});
    expect(blocked.errors[0]?.category).toBe('ReadOnlyProtection');
    const c = await run('const x=db.collection("users").findOne({name:"missing"});\nx.name;\nprint("skipped");', {sourceOffset:{line:7,column:4}});
    expect(c.errors[0]?.index).toBe(1);
    expect(c.events.find(event=>event.type==='statement-error')).toMatchObject({range:{startLine:9,startCol:1}});
    expect(c.events.find(event=>event.type==='statement-skipped')).toMatchObject({index:2});
  });
});
