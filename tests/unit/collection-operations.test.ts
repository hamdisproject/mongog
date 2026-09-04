import { Decimal128, Int32, Long, ObjectId } from 'bson';
import type { MongoClient } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import {
  assertBulkFieldPath,
  assertDocumentIdUnchanged,
  bulkDeleteCollectionDocuments,
  parseEjsonDocumentArray,
  parseEjsonDocument,
  parseEjsonValue,
  parseQueryDocumentExpression,
  parseStrictEjsonDocument,
} from '../../src/query-runtime/collection/operations.js';
import {
  bulkDeletePayloadExceedsLimit,
  bulkFieldPathError,
  bulkUpdatePayloadExceedsLimit,
} from '../../src/shared/collection-update.js';
import {
  connCollectionBulkDeleteSchema,
  connCollectionBulkUpdateSchema,
} from '../../src/shared/ipc/index.js';

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

  it('validates bulk field paths and standalone BSON values', () => {
    expect(() => assertBulkFieldPath('address.city')).not.toThrow();
    expect(() => assertBulkFieldPath('items.0.price')).not.toThrow();
    expect(() => assertBulkFieldPath('_id')).toThrow(expect.objectContaining({ category: 'Validation' }));
    expect(() => assertBulkFieldPath('_id.value')).toThrow(expect.objectContaining({ category: 'Validation' }));
    expect(() => assertBulkFieldPath('items.$[].price')).toThrow(expect.objectContaining({ category: 'Validation' }));
    expect(() => assertBulkFieldPath('address..city')).toThrow(expect.objectContaining({ category: 'Validation' }));
    expect(parseEjsonValue('Long("42")', 'Field value')).toBeInstanceOf(Long);
    expect(() => parseEjsonValue('{ $where: "unsafe" }', 'Field value'))
      .toThrow(expect.objectContaining({ category: 'Validation' }));
    expect(bulkFieldPathError('valid.path')).toBeNull();
    expect(bulkUpdatePayloadExceedsLimit(['€'], 6)).toBe(true);
    expect(bulkUpdatePayloadExceedsLimit(['€'], 7)).toBe(false);
    expect(bulkDeletePayloadExceedsLimit(['€'], 6)).toBe(true);
    expect(bulkDeletePayloadExceedsLimit(['€'], 7)).toBe(false);
  });

  it('parses safe full-document arrays with BSON types', () => {
    const documents = parseEjsonDocumentArray(`[
      { _id: ObjectId("507f1f77bcf86cd799439011"), value: Int32(1) },
      { _id: ObjectId("507f1f77bcf86cd799439012"), value: Decimal128("2.5") },
    ]`, 'Documents');
    expect(documents).toHaveLength(2);
    expect(documents[0]?._id).toBeInstanceOf(ObjectId);
    expect(documents[1]?.value).toBeInstanceOf(Decimal128);
    expect(() => parseEjsonDocumentArray('[{ _id: 1 }, 2]', 'Documents'))
      .toThrow(expect.objectContaining({ category: 'Validation' }));
  });

  it('bounds and validates the collection bulk update IPC request', () => {
    expect(connCollectionBulkUpdateSchema.safeParse({
      connectionId: 'connection',
      database: 'database',
      collection: 'collection',
      originalDocumentsEjson: ['{"_id":1}'],
      change: { kind: 'field', path: 'status', operation: 'set', valueEjson: '"ready"' },
    }).success).toBe(true);
    expect(connCollectionBulkUpdateSchema.safeParse({
      connectionId: 'connection',
      database: 'database',
      collection: 'collection',
      originalDocumentsEjson: Array.from({ length: 501 }, () => '{"_id":1}'),
      change: { kind: 'field', path: 'status', operation: 'unset' },
    }).success).toBe(false);
  });

  it('bounds and validates the collection bulk delete IPC request', () => {
    expect(connCollectionBulkDeleteSchema.safeParse({
      connectionId: 'connection',
      database: 'database',
      collection: 'collection',
      originalDocumentsEjson: ['{"_id":1}'],
    }).success).toBe(true);
    expect(connCollectionBulkDeleteSchema.safeParse({
      connectionId: 'connection',
      database: 'database',
      collection: 'collection',
      originalDocumentsEjson: [],
    }).success).toBe(false);
    expect(connCollectionBulkDeleteSchema.safeParse({
      connectionId: 'connection',
      database: 'database',
      collection: 'collection',
      originalDocumentsEjson: Array.from({ length: 501 }, () => '{"_id":1}'),
    }).success).toBe(false);
  });

  it('validates every bulk delete original before accessing MongoDB', async () => {
    const db = vi.fn();
    const client = { db } as unknown as MongoClient;

    await expect(bulkDeleteCollectionDocuments(client, {
      database: 'database',
      collection: 'collection',
      originalDocumentsEjson: ['{"_id":1}', '{"value":2}'],
    })).rejects.toMatchObject({ category: 'Validation' });
    await expect(bulkDeleteCollectionDocuments(client, {
      database: 'database',
      collection: 'collection',
      originalDocumentsEjson: ['{"_id":1}', '{"_id":1}'],
    })).rejects.toMatchObject({ category: 'Validation' });
    expect(db).not.toHaveBeenCalled();
  });
});
