import { describe, expect, it } from 'vitest';
import {
  DocumentExpressionError,
  parseDocumentArrayExpression,
  parseDocumentExpression,
  parseValueExpression,
} from '../../src/features/script-analysis/index.js';
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

describe('safe document expressions', () => {
  it('normalizes unquoted keys, single quotes, comments, trailing commas, and nested arrays', () => {
    const parsed = parseDocumentExpression(`{
      // query criteria
      bikeid: 17827,
      status: 'ready',
      score: { $gte: -2.5, },
      tags: ['a', true, null,],
    }`, 'Filter');

    expect(JSON.parse(parsed.json)).toEqual({
      bikeid: 17827,
      status: 'ready',
      score: { $gte: -2.5 },
      tags: ['a', true, null],
    });
  });

  it('preserves canonical Extended JSON objects and prototype-named fields as data', () => {
    const parsed = parseDocumentExpression(`{
      _id: { $oid: '507f1f77bcf86cd799439011' },
      __proto__: { safe: true },
      constructor: 'field',
    }`);
    const value = JSON.parse(parsed.json) as Record<string, unknown>;
    expect(value._id).toEqual({ $oid: '507f1f77bcf86cd799439011' });
    expect(value.__proto__).toEqual({ safe: true });
    expect(value.constructor).toBe('field');
  });

  it.each([
    ['call', '{ value: getBikeId() }'],
    ['new expression', '{ value: new Date() }'],
    ['unsupported new expression', '{ value: new ObjectId("507f1f77bcf86cd799439011") }'],
    ['spread', '{ ...other }'],
    ['computed property', '{ ["value"]: 1 }'],
    ['shorthand property', '{ value }'],
    ['template expression', '{ value: `x${name}` }'],
    ['top-level array', '[{ value: 1 }]'],
    ['MongoDB $where operator', "{ $where: 'return true' }"],
    ['nested MongoDB $function operator', "{ $expr: { $function: { body: 'return true' } } }"],
  ])('rejects %s without evaluating it', (_label, source) => {
    expect(() => parseDocumentExpression(source, 'Filter')).toThrow(DocumentExpressionError);
  });

  it('converts Compass-style BSON constructors and aliases without executing source', () => {
    const parsed = parseDocumentExpression(`{
      _id: ObjectId("507f1f77bcf86cd799439011"),
      createdAt: ISODate('2026-01-01T00:00:00.000Z'),
      createdAtNew: new Date('2026-01-02T00:00:00.000Z'),
      int: NumberInt(42),
      long: NumberLong("9223372036854775807"),
      double: Double(3.5),
      decimal: NumberDecimal("125.50"),
      binary: BinData(0, "AQID"),
      uuid: UUID("00112233-4455-6677-8899-aabbccddeeff"),
      regex: /bike\\/id/im,
      bsonRegex: BSONRegExp("^bike", "i"),
      timestamp: Timestamp({ t: 1700000000, i: 4 }),
      min: MinKey(), max: MaxKey(),
      ref: DBRef("items", ObjectId("507f1f77bcf86cd799439012")),
      code: Code("return value", { value: 1 }),
      symbol: BSONSymbol("legacy"),
    }`, 'Document');
    const value = EJSON.parse(parsed.json, { relaxed: false }) as Record<string, unknown>;

    expect(value._id).toBeInstanceOf(ObjectId);
    expect(value.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(value.createdAtNew).toEqual(new Date('2026-01-02T00:00:00.000Z'));
    expect(value.int).toBeInstanceOf(Int32);
    expect(value.long).toBeInstanceOf(Long);
    expect(value.double).toBeInstanceOf(Double);
    expect(value.decimal).toBeInstanceOf(Decimal128);
    expect(value.binary).toBeInstanceOf(Binary);
    expect(value.uuid).toBeInstanceOf(UUID);
    expect(value.regex).toBeInstanceOf(BSONRegExp);
    expect(value.bsonRegex).toBeInstanceOf(BSONRegExp);
    expect(value.timestamp).toBeInstanceOf(Timestamp);
    expect(value.min).toBeInstanceOf(MinKey);
    expect(value.max).toBeInstanceOf(MaxKey);
    expect(value.ref).toBeInstanceOf(DBRef);
    expect(value.code).toBeInstanceOf(Code);
    expect(value.symbol).toBeInstanceOf(BSONSymbol);
  });

  it('parses standalone literal BSON values for field updates', () => {
    const parsed = parseValueExpression('Decimal128("125.50")', 'Field value');
    const value = EJSON.parse(parsed.json, { relaxed: false });
    expect(value).toBeInstanceOf(Decimal128);
    expect((value as Decimal128).toString()).toBe('125.50');
    expect(EJSON.parse(parseValueExpression('[Int32(1), null, "x"]').json, { relaxed: false }))
      .toEqual([new Int32(1), null, 'x']);
  });

  it('parses document arrays while rejecting non-document and executable entries', () => {
    const parsed = parseDocumentArrayExpression(`[
      { _id: ObjectId("507f1f77bcf86cd799439011"), value: Int32(1) },
      { _id: ObjectId("507f1f77bcf86cd799439012"), value: Decimal128("2.5") },
    ]`);
    const documents = EJSON.parse(parsed.json, { relaxed: false }) as Array<Record<string, unknown>>;
    expect(documents).toHaveLength(2);
    expect(documents[0]?._id).toBeInstanceOf(ObjectId);
    expect(documents[1]?.value).toBeInstanceOf(Decimal128);
    expect(() => parseDocumentArrayExpression('[{ _id: 1 }, 2]')).toThrow(DocumentExpressionError);
    expect(() => parseDocumentArrayExpression('[{ value: run() }]')).toThrow(DocumentExpressionError);
  });

  it.each([
    ['argumentless ObjectId', '{ value: ObjectId() }'],
    ['argumentless ISODate', '{ value: ISODate() }'],
    ['dynamic argument', '{ value: ObjectId(id) }'],
    ['method call', '{ value: helper.ObjectId("507f1f77bcf86cd799439011") }'],
    ['invalid ObjectId', '{ value: ObjectId("bad") }'],
  ])('rejects unsafe or invalid constructor input: %s', (_label, source) => {
    expect(() => parseDocumentExpression(source, 'Filter')).toThrow(DocumentExpressionError);
  });

  it('reports source-relative ranges for invalid values', () => {
    try {
      parseDocumentExpression('{ safe: 1, unsafe: run() }', 'Filter');
      throw new Error('Expected parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentExpressionError);
      expect(error).toMatchObject({ start: 19, end: 24 });
    }
  });
});
