import { ObjectId } from 'bson';
import { describe, expect, it } from 'vitest';
import {
  assertDocumentIdUnchanged,
  parseEjsonDocument,
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
