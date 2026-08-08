import { Decimal128, Int32, Long, ObjectId } from 'bson';
import { describe, expect, it } from 'vitest';
import {
  assertDocumentIdUnchanged,
  parseEjsonDocument,
  parseQueryDocumentExpression,
  parseStrictEjsonDocument,
} from '../../src/query-runtime/collection/operations.js';

describe('collection operation validation', () => {
  it('parses canonical Extended JSON into BSON values', () => {
    const id = new ObjectId();
    const parsed = parseEjsonDocument(`{"_id":{"$oid":"${id.toHexString()}"}}`, 'Document');
    expect(parsed._id).toBeInstanceOf(ObjectId);
    expect((parsed._id as ObjectId).equals(id)).toBe(true);
  });

  it('parses MongoDB Shell document syntax without losing BSON types', () => {
    const parsed = parseEjsonDocument(`{
      _id: ObjectId("507f1f77bcf86cd799439011"),
      createdAt: ISODate("2026-01-01T00:00:00.000Z"),
      amount: Decimal128("125.50"),
      sequence: Long("9223372036854775807"),
    }`, 'Document');
    expect(parsed._id).toBeInstanceOf(ObjectId);
    expect(parsed.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(parsed.amount).toBeInstanceOf(Decimal128);
    expect(parsed.sequence).toBeInstanceOf(Long);
  });

  it('keeps administration-style parsing strictly Extended JSON', () => {
    expect(() => parseStrictEjsonDocument(
      '{ _id: ObjectId("507f1f77bcf86cd799439011") }',
      'Administration input',
    )).toThrow(expect.objectContaining({ category: 'Validation' }));
  });

  it('rejects invalid JSON and non-document roots', () => {
    expect(() => parseEjsonDocument('{', 'Document')).toThrow(expect.objectContaining({
      category: 'Validation',
    }));
    expect(() => parseEjsonDocument('[]', 'Document')).toThrow(expect.objectContaining({
      category: 'Validation',
    }));
  });

  it('parses safe object expressions and canonical BSON values for browser criteria', () => {
    const id = new ObjectId('507f1f77bcf86cd799439011');
    const parsed = parseQueryDocumentExpression(
      `{ bikeid: 17827, _id: { $oid: '${id.toHexString()}' } }`,
      'Filter',
    );
    expect(parsed.bikeid).toBeInstanceOf(Int32);
    expect((parsed.bikeid as Int32).valueOf()).toBe(17827);
    expect(parsed._id).toBeInstanceOf(ObjectId);
    expect((parsed._id as ObjectId).equals(id)).toBe(true);
  });

  it('parses Compass-style BSON values for browser criteria', () => {
    const parsed = parseQueryDocumentExpression(`{
      _id: ObjectId("507f1f77bcf86cd799439011"),
      createdAt: { $gte: ISODate("2026-01-01T00:00:00.000Z") },
      sequence: Long("42"),
      name: /^bike/i,
    }`, 'Filter');
    expect(parsed._id).toBeInstanceOf(ObjectId);
    expect((parsed.createdAt as { $gte: unknown }).$gte).toBeInstanceOf(Date);
    expect(parsed.sequence).toBeInstanceOf(Long);
  });

  it('rejects executable browser criteria', () => {
    expect(() => parseQueryDocumentExpression('{ bikeid: getBikeId() }', 'Filter'))
      .toThrow(expect.objectContaining({ category: 'Validation' }));
    expect(() => parseQueryDocumentExpression("{ $where: 'return true' }", 'Filter'))
      .toThrow(expect.objectContaining({
        category: 'Validation',
        message: expect.stringContaining('$where'),
      }));
    expect(() => parseQueryDocumentExpression(
      "{ $expr: { $function: { body: 'return true', args: [], lang: 'js' } } }",
      'Filter',
    )).toThrow(expect.objectContaining({ category: 'Validation' }));
  });

  it('rejects executable operators in nested document input for every accepted syntax', () => {
    expect(() => parseEjsonDocument('{ "nested": { "$where": "return true" } }', 'Document'))
      .toThrow(expect.objectContaining({ category: 'Validation' }));
    expect(() => parseEjsonDocument(
      '{ nested: { $accumulator: { init: "unsafe" } } }',
      'Document',
    )).toThrow(expect.objectContaining({ category: 'Validation' }));
  });

  it('rejects missing or changed immutable _id values', () => {
    const id = new ObjectId();
    expect(() => assertDocumentIdUnchanged(
      { _id: id, value: 1 },
      { _id: new ObjectId(), value: 2 },
    )).toThrow(expect.objectContaining({ category: 'Validation' }));
    expect(() => assertDocumentIdUnchanged(
      { _id: id, value: 1 },
      { value: 2 },
    )).toThrow(expect.objectContaining({ category: 'Validation' }));
  });
});
