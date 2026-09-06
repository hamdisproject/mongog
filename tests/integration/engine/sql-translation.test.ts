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
    expect(translation.execution).toBe('find');
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
});
