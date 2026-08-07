/**
 * S7 (data part): schema sampling infers field paths, multi-type fields,
 * presence ratios and array element types — always labelled inferred.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId, Decimal128, type MongoClient } from 'mongodb';
import { sampleSchema, detectBsonType } from '../../src/query-runtime/metadata/sample.js';
import { getStandaloneUri, newClient, stopAll } from './helpers/mongo.js';

describe('schema sampling', () => {
  let client: MongoClient;

  beforeAll(async () => {
    const uri = await getStandaloneUri();
    client = await newClient(uri);
    const coll = client.db('mongog_test').collection('mixed');
    const docs = [];
    for (let i = 0; i < 100; i++) {
      docs.push({
        _id: new ObjectId(),
        name: `user-${i}`,
        age: i % 3 === 0 ? `${i}` : i, // multi-type: string | int32
        address: { city: i % 2 === 0 ? 'Istanbul' : 'Ankara', zip: i },
        tags: ['a', i % 5 === 0 ? i : 'b'],
        balance: Decimal128.fromString('10.5'),
        ...(i % 4 === 0 ? { nickname: `nick-${i}` } : {}), // 25% presence
      });
    }
    await coll.insertMany(docs);
  });

  afterAll(async () => {
    await stopAll();
  });

  it('infers paths, types, presence and array element types', async () => {
    const result = await sampleSchema(client.db('mongog_test'), 'mixed', { sampleSize: 100 });
    expect(result.sampledCount).toBe(100);

    const byPath = new Map(result.fields.map((f) => [f.path, f]));
    expect(byPath.has('_id')).toBe(true);
    expect(byPath.get('_id')!.types[0]!.bsonType).toBe('objectid');

    const age = byPath.get('age');
    expect(age).toBeDefined();
    const ageTypes = age!.types.map((t) => t.bsonType).sort();
    expect(ageTypes).toEqual(['int32', 'string']);

    expect(byPath.has('address.city')).toBe(true);
    expect(byPath.get('address.city')!.presence).toBe(1);

    const nickname = byPath.get('nickname');
    expect(nickname).toBeDefined();
    expect(nickname!.presence).toBeGreaterThan(0.1);
    expect(nickname!.presence).toBeLessThan(0.4);

    const tags = byPath.get('tags');
    expect(tags!.types[0]!.bsonType).toBe('array');
    expect(tags!.arrayElementTypes).toContain('string');

    expect(byPath.get('balance')!.types[0]!.bsonType).toBe('decimal128');
  });

  it('detectBsonType prefers real BSON markers', () => {
    expect(detectBsonType(new ObjectId())).toBe('objectid');
    expect(detectBsonType(Decimal128.fromString('1.5'))).toBe('decimal128');
    expect(detectBsonType(new Date())).toBe('date');
    expect(detectBsonType(42)).toBe('int32');
    expect(detectBsonType(4.2)).toBe('double');
    expect(detectBsonType([1])).toBe('array');
    expect(detectBsonType(null)).toBe('null');
    expect(detectBsonType({ a: 1 })).toBe('object');
  });

  it('honours inference path bounds', async () => {
    const result = await sampleSchema(client.db('mongog_test'), 'mixed', {
      sampleSize: 20,
      maxPaths: 4,
      maxDepth: 1,
    });
    expect(result.sampledCount).toBe(20);
    expect(result.fields.length).toBeLessThanOrEqual(4);
  });

  it('returns a cacheable empty inferred schema for an empty collection', async () => {
    const result = await sampleSchema(client.db('mongog_test'), 'empty', { sampleSize: 50 });
    expect(result).toEqual({ fields: [], sampledCount: 0, sampleSize: 50 });
  });
});
