/**
 * S5: every required BSON type survives engine capture + EJSON serialization
 * + renderer-side parsing, byte-identical at the canonical level.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import {
  Binary,
  BSONRegExp,
  Code,
  DBRef,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  UUID,
} from 'bson';
import { ExecutionEngine } from '../../src/query-runtime/engine/execute.js';
import { CursorRegistry } from '../../src/query-runtime/registry/cursors.js';
import type { EngineEvent } from '../../src/shared/domain/index.js';
import { parseEjson, renderEjson } from '../../src/shared/ejson/index.js';
import { getStandaloneUri, newClient, stopAll } from './helpers/mongo.js';

const corpusDoc = {
  _id: new ObjectId('64b64c0000000000000000aa'),
  oid: new ObjectId('64b64c0000000000000000ab'),
  when: new Date('2026-01-02T03:04:05.006Z'),
  price: Decimal128.fromString('1234.5678'),
  big: Long.fromString('9223372036854775807'),
  i32: new Int32(42),
  dbl: new Double(3.14159),
  bin: new Binary(Buffer.from([1, 2, 3, 4]), 0),
  uuid: new UUID('123e4567-e89b-12d3-a456-426614174000'),
  ts: new Timestamp({ t: 1700000000, i: 1 }),
  re: new BSONRegExp('^ab+c$', 'i'),
  min: new MinKey(),
  max: new MaxKey(),
  code: new Code('function() { return 1; }'),
  ref: new DBRef('other', new ObjectId('64b64c0000000000000000ac')),
  nested: { arr: [1, 'two', { three: new ObjectId('64b64c0000000000000000ad') }] },
  nil: null,
};

describe('BSON corpus round-trip through the engine', () => {
  let client: MongoClient;
  let registry: CursorRegistry;
  let engine: ExecutionEngine;

  beforeAll(async () => {
    const uri = await getStandaloneUri();
    client = await newClient(uri);
    registry = new CursorRegistry();
    engine = new ExecutionEngine(registry);
    await client.db('mongog_test').collection('corpus').deleteMany({});
    await client.db('mongog_test').collection('corpus').insertOne(corpusDoc);
  });

  afterAll(async () => {
    await registry.dispose();
    await stopAll();
  });

  it('findOne result survives with canonical equality for every field', async () => {
    const events: EngineEvent[] = [];
    const handle = engine.execute(
      {
        client,
        database: 'mongog_test',
        source: 'db.collection("corpus").findOne({});',
        mode: 'query',
        registry,
        owner: { connectionId: 'corpus' },
      },
      (e) => events.push(e),
    );
    await handle.promise;

    const result = events.find((e) => e.type === 'result');
    if (result?.type !== 'result' || result.result.kind !== 'scalar') {
      throw new Error('expected scalar result');
    }
    const doc = parseEjson<Record<string, unknown>>(result.result.value);
    expect(doc).toBeTruthy();
    for (const [key, value] of Object.entries(corpusDoc)) {
      expect(renderEjson(doc[key], 'canonical'), `field ${key}`).toBe(
        renderEjson(value, 'canonical'),
      );
    }
  });

  it('documents (cursor) results carry typed envelopes per document', async () => {
    const events: EngineEvent[] = [];
    const handle = engine.execute(
      {
        client,
        database: 'mongog_test',
        source: 'db.collection("corpus").find({});',
        mode: 'query',
        registry,
        owner: { connectionId: 'corpus' },
      },
      (e) => events.push(e),
    );
    await handle.promise;
    const result = events.find((e) => e.type === 'result');
    if (result?.type !== 'result' || result.result.kind !== 'documents') {
      throw new Error('expected documents result');
    }
    expect(result.result.documents).toHaveLength(1);
    const doc = parseEjson<Record<string, unknown>>(result.result.documents[0]!);
    expect(renderEjson(doc.price, 'canonical')).toBe(renderEjson(corpusDoc.price, 'canonical'));
    expect(renderEjson(doc.uuid, 'canonical')).toBe(renderEjson(corpusDoc.uuid, 'canonical'));
  });
});
