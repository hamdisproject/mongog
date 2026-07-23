import { describe, expect, it } from 'vitest';
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
import {
  parseEjson,
  renderEjson,
  serializeToEjson,
  serializeToEjsonWithFull,
} from '../../src/shared/ejson/index.js';

const corpus: Array<[string, unknown]> = [
  ['ObjectId', new ObjectId('64b64c000000000000000001')],
  ['Date', new Date('2026-01-02T03:04:05.006Z')],
  ['Decimal128', Decimal128.fromString('1234.5678')],
  ['Long', Long.fromString('9223372036854775807')],
  ['Int32', new Int32(42)],
  ['Double', new Double(3.14159)],
  ['Binary', new Binary(Buffer.from([1, 2, 3, 4]), 0)],
  ['UUID', new UUID('123e4567-e89b-12d3-a456-426614174000')],
  ['Timestamp', new Timestamp({ t: 1700000000, i: 1 })],
  ['BSONRegExp', new BSONRegExp('^ab+c$', 'i')],
  ['MinKey', new MinKey()],
  ['MaxKey', new MaxKey()],
  ['Code', new Code('function() { return 1; }')],
  ['DBRef', new DBRef('coll', new ObjectId('64b64c000000000000000002'))],
  ['string', 'hello'],
  ['number', 42.5],
  ['boolean', true],
  ['null', null],
  ['nested', { a: [1, { b: new ObjectId('64b64c000000000000000003') }], c: 'x' }],
];

describe('EJSON envelopes', () => {
  it.each(corpus)('round-trips %s without type loss', (_name, value) => {
    const env = serializeToEjson({ v: value });
    expect(env.truncated).toBe(false);
    const back = parseEjson<{ v: unknown }>(env);
    // Canonical re-serialization must be identical (type + value preserved).
    expect(renderEjson(back.v, 'canonical')).toBe(renderEjson(value, 'canonical'));
  });

  it('truncates oversized documents with a flag', () => {
    const big = { payload: 'x'.repeat(100_000) };
    const env = serializeToEjson(big, 1024);
    expect(env.truncated).toBe(true);
    expect(env.byteSize).toBeGreaterThan(100_000);
    expect(env.ejson.length).toBeLessThanOrEqual(1024);
  });

  it('can return a full envelope beside an oversized preview without type loss', () => {
    const big = { _id: new ObjectId('64b64c000000000000000004'), payload: 'x'.repeat(5_000) };
    const serialized = serializeToEjsonWithFull(big, 128);
    expect(serialized.preview.truncated).toBe(true);
    expect(serialized.full?.truncated).toBe(false);
    expect(parseEjson(serialized.full!)).toEqual(big);
  });

  it('degrades circular JS values to an opaque envelope instead of throwing', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const env = serializeToEjson(a);
    expect(env.ejson).toContain('$mongogOpaque');
  });

  it('renders relaxed vs canonical modes distinctly', () => {
    const value = { n: new Int32(5), d: new Date(0) };
    const relaxed = renderEjson(value, 'relaxed');
    const canonical = renderEjson(value, 'canonical');
    expect(relaxed).not.toBe(canonical);
    expect(canonical).toContain('$numberInt');
    expect(relaxed).toContain('"n": 5');
  });
});
