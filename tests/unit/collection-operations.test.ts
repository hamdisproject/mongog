import { Int32, ObjectId } from 'bson';
import { describe, expect, it } from 'vitest';
import {
  assertDocumentIdUnchanged,
  parseEjsonDocument,
  parseQueryDocumentExpression,
} from '../../src/query-runtime/collection/operations.js';

describe('collection operation validation', () => {
  it('parses canonical Extended JSON into BSON values', () => {
    const id = new ObjectId();
    const parsed = parseEjsonDocument(`{"_id":{"$oid":"${id.toHexString()}"}}`, 'Document');
    expect(parsed._id).toBeInstanceOf(ObjectId);
    expect((parsed._id as ObjectId).equals(id)).toBe(true);
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
