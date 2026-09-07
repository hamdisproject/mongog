import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { ExecutionEngine } from '../../../src/query-runtime/engine/execute.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import { translateSql } from '../../../src/features/sql-translator/index.js';
import { parseEjson } from '../../../src/shared/ejson/index.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';
import { executeAndCollect } from './helpers/execution.js';

const suite = useMongoIntegrationSuite('engine sql translation');
const DATABASE = suite.databaseName;

describe('SQL translation executes through the script engine (real mongod)', () => {
  let client: MongoClient;
  let registry: CursorRegistry;
  let engine: ExecutionEngine;

  beforeAll(async () => {
    client = await suite.newClient(suite.standaloneUri);
    registry = new CursorRegistry();
    engine = new ExecutionEngine(registry);
    await client.db(DATABASE).collection('sql_orders').insertMany([
      { status: 'shipped', total: 150 },
      { status: 'shipped', total: 90 },
      { status: 'pending', total: 40 },
    ]);
    await client.db(DATABASE).collection('sql_shipments').insertMany([
      { orderStatus: 'shipped', carrier: 'fast' },
    ]);
  }, 120_000);

  afterAll(async () => {
    await registry.dispose();
  });

  const runSql = async (sql: string) => {
    const translation = translateSql(sql);
    return {
      translation,
      collected: await executeAndCollect(engine, client, registry, DATABASE, translation.jsSource),
    };
  };

  const documentsOf = (collected: Awaited<ReturnType<typeof executeAndCollect>>) => {
    const first = collected.results[0];
    if (!first || first.result.kind !== 'documents') throw new Error('expected documents result');
    return first.result.documents.map((envelope) => parseEjson<Record<string, unknown>>(envelope));
  };

  it('runs a translated SELECT with WHERE/ORDER BY/LIMIT', async () => {
    const { translation, collected } = await runSql(
      `SELECT status, total FROM sql_orders WHERE total > 50 ORDER BY total DESC LIMIT 2`,
    );
    expect(translation.execution).toBe('aggregate');
    expect(collected.finished?.status).toBe('completed');
    const docs = documentsOf(collected);
    expect(docs).toHaveLength(2);
    expect(docs[0]?.status).toBe('shipped');
    expect(Number(docs[0]?.total)).toBe(150);
    expect(Number(docs[1]?.total)).toBe(90);
  });

  it('runs a translated GROUP BY aggregation', async () => {
    const { translation, collected } = await runSql(
      'SELECT status, COUNT(*) AS cnt FROM sql_orders GROUP BY status ORDER BY cnt DESC',
    );
    expect(translation.execution).toBe('aggregate');
    expect(collected.finished?.status).toBe('completed');
    const docs = documentsOf(collected);
    const byStatus = new Map(docs.map((doc) => [String(doc.status), Number(doc.cnt)]));
    expect(byStatus.get('shipped')).toBe(2);
    expect(byStatus.get('pending')).toBe(1);
  });

  it('runs a translated INSERT then DELETE round-trip', async () => {
    const insert = translateSql(`INSERT INTO sql_roundtrip (user_id, age) VALUES ('abc', 55)`);
    const inserted = await executeAndCollect(engine, client, registry, DATABASE, insert.jsSource);
    expect(inserted.finished?.status).toBe('completed');

    const selected = await runSql(`SELECT user_id, age FROM sql_roundtrip WHERE user_id = 'abc'`);
    expect(documentsOf(selected.collected)).toHaveLength(1);

    const remove = translateSql(`DELETE FROM sql_roundtrip WHERE user_id = 'abc'`);
    const deleted = await executeAndCollect(engine, client, registry, DATABASE, remove.jsSource);
    expect(deleted.finished?.status).toBe('completed');
    const after = await runSql(`SELECT * FROM sql_roundtrip WHERE user_id = 'abc'`);
    expect(documentsOf(after.collected)).toHaveLength(0);
  });

  it('runs UPDATE against every matching document on standalone MongoDB', async () => {
    const collection = client.db(DATABASE).collection('sql_updates');
    await collection.insertMany([
      { cohort: 'a', value: 1 },
      { cohort: 'a', value: 2 },
      { cohort: 'b', value: 3 },
    ]);
    const update = translateSql(`UPDATE sql_updates SET value = 9 WHERE cohort = 'a'`);
    const updated = await executeAndCollect(engine, client, registry, DATABASE, update.jsSource);
    expect(updated.finished?.status).toBe('completed');
    expect(await collection.countDocuments({ cohort: 'a', value: 9 })).toBe(2);
    expect(await collection.countDocuments({ cohort: 'b', value: 3 })).toBe(1);
  });

  it('keeps missing and NULL fields out of negative write predicates', async () => {
    const collection = client.db(DATABASE).collection('sql_null_scope');
    await collection.insertMany([
      { key: 'missing' },
      { key: 'null', value: null },
      { key: 'a', value: 'A' },
      { key: 'b', value: 'B' },
    ]);
    const remove = translateSql(`DELETE FROM sql_null_scope WHERE value <> 'A'`);
    const deleted = await executeAndCollect(engine, client, registry, DATABASE, remove.jsSource);
    expect(deleted.finished?.status).toBe('completed');
    expect(await collection.find({}, { projection: { _id: 0, key: 1 } }).sort({ key: 1 }).toArray())
      .toEqual([{ key: 'a' }, { key: 'missing' }, { key: 'null' }]);
  });

  it('counts false, zero and empty string while excluding NULL/missing values', async () => {
    const collection = client.db(DATABASE).collection('sql_count_values');
    await collection.insertMany([
      { value: false },
      { value: 0 },
      { value: '' },
      { value: null },
      { other: true },
    ]);
    const { collected } = await runSql('SELECT COUNT(value) AS count FROM sql_count_values');
    expect(Number(documentsOf(collected)[0]?.count)).toBe(3);
  });

  it('executes qualified JOIN projections and preserves LEFT JOIN rows', async () => {
    const { collected } = await runSql(
      'SELECT o.status, s.carrier FROM sql_orders o LEFT JOIN sql_shipments s ON o.status = s.orderStatus ORDER BY status',
    );
    const docs = documentsOf(collected);
    expect(docs).toHaveLength(3);
    expect(docs.filter((doc) => doc.status === 'shipped' && doc.carrier === 'fast')).toHaveLength(2);
    expect(docs.some((doc) => doc.status === 'pending')).toBe(true);
  });

  it('rejects unsupported write limits before anything reaches MongoDB', async () => {
    const collection = client.db(DATABASE).collection('sql_fail_closed');
    await collection.insertMany([{ value: 1 }, { value: 2 }]);
    expect(() => translateSql('UPDATE sql_fail_closed SET value = 9 LIMIT 1')).toThrow(/LIMIT/);
    expect(() => translateSql('DELETE FROM sql_fail_closed LIMIT 1')).toThrow(/LIMIT/);
    expect(await collection.countDocuments({})).toBe(2);
    expect(await collection.countDocuments({ value: 9 })).toBe(0);
  });

  it('preserves prototype-named fields through generated code', async () => {
    const collection = client.db(DATABASE).collection('sql_prototype_fields');
    const inserted = await runSql('INSERT INTO sql_prototype_fields (`__proto__`, value) VALUES (1, 2)');
    expect(inserted.collected.finished?.status).toBe('completed');
    const original = await collection.findOne({ value: 2 });
    expect(original).not.toBeNull();
    expect(Object.hasOwn(original!, '__proto__')).toBe(true);
    expect(original?.__proto__).toBe(1);

    const updated = await runSql('UPDATE sql_prototype_fields SET `__proto__` = 3 WHERE value = 2');
    expect(updated.collected.finished?.status).toBe('completed');
    expect((await collection.findOne({ value: 2 }))?.__proto__).toBe(3);
  });
});
