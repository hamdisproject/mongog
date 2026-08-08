import { describe, expect, it } from 'vitest';
import {
  Binary,
  BSONRegExp,
  BSONSymbol,
  Code,
  DBRef,
  Decimal128,
  Double,
  EJSON,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  UUID,
} from 'bson';
import { parseDocumentExpression } from '../../src/features/script-analysis/index.js';
import {
  parseEjson,
  renderBson,
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
  ['BSONSymbol', new BSONSymbol('legacy')],
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

  it.each(corpus)('renders %s in mongosh syntax and round-trips BSON values', (_name, value) => {
    const source = `{ value: ${renderBson(value, 'mongosh', true, 'editable')} }`;
    const parsed = parseDocumentExpression(source, 'Document');
    const restored = EJSON.parse(parsed.json, { relaxed: false }) as { value: unknown };
    expect(renderEjson(restored.value, 'canonical')).toBe(renderEjson(value, 'canonical'));
  });

  it('shows common BSON numeric values without constructor noise', () => {
    const rendered = renderBson({
      price: Decimal128.fromString('1492.00'),
      count: new Int32(8),
      longitude: new Double(-73.84913837242902),
    }, 'mongosh', true);

    expect(rendered).toContain('price: 1492.00');
    expect(rendered).toContain('count: 8');
    expect(rendered).toContain('longitude: -73.84913837242902');
    expect(rendered).not.toMatch(/Decimal128|Int32|Double/);
  });

  it('keeps BSON numeric constructors in editable document source', () => {
    const rendered = renderBson({
      price: Decimal128.fromString('1492.00'),
      count: new Int32(8),
      longitude: new Double(-73.84913837242902),
    }, 'mongosh', true, 'editable');

    expect(rendered).toContain('Decimal128("1492.00")');
    expect(rendered).toContain('Int32(8)');
    expect(rendered).toContain('Double(-73.84913837242902)');
  });

  it('uses compact nested shell constructors for table cells', () => {
    const rendered = renderBson({
      _id: new ObjectId('64b64c000000000000000001'),
      createdAt: new Date('2026-01-02T03:04:05.006Z'),
      count: Long.fromString('9007199254740993'),
    }, 'mongosh', false);
    expect(rendered).toContain('ObjectId("64b64c000000000000000001")');
    expect(rendered).toContain('ISODate("2026-01-02T03:04:05.006Z")');
    expect(rendered).toContain('Long("9007199254740993")');
    expect(rendered).not.toContain('\n');
  });
});
