import { describe, expect, it } from 'vitest';
import { Decimal128, Int32, Long, ObjectId } from 'bson';
import {
  dataTransferStartConnectionCopySchema,
  dataTransferStartFileImportSchema,
} from '../../src/shared/ipc/index.js';
import {
  convertColumnValue,
  FileImportManager,
  inferColumnType,
  mapFileRow,
} from '../../src/query-runtime/data-transfer/file-import.js';
import {
  TRANSFER_MAX_BATCH_BYTES,
  TRANSFER_MAX_BATCH_DOCUMENTS,
} from '../../src/query-runtime/data-transfer/write.js';
import type { MongoClient } from 'mongodb';

describe('data transfer contracts', () => {
  it('rejects source deletion fields instead of silently accepting them', () => {
    const result = dataTransferStartConnectionCopySchema.safeParse({
      sourceConnectionId: 'source',
      targetConnectionId: 'target',
      deleteSource: true,
      datasets: [copyDataset()],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a source and target that are the same physical namespace', () => {
    const result = dataTransferStartConnectionCopySchema.safeParse({
      sourceConnectionId: 'same',
      targetConnectionId: 'same',
      datasets: [copyDataset()],
    });
    expect(result.success).toBe(false);
  });

  it('rejects path-bearing or source mutation fields from file import payloads', () => {
    const result = dataTransferStartFileImportSchema.safeParse({
      targetConnectionId: 'target',
      datasets: [{
        fileToken: '123e4567-e89b-12d3-a456-426614174000',
        path: '/private/source.csv',
        deleteSource: true,
        targetDatabase: 'db',
        targetCollection: 'items',
        mappings: [{ sourceColumn: 'name', included: true, targetField: 'name', type: 'string' }],
        emptyCellPolicy: 'omit',
        conflictMode: 'insert-stop',
        rowErrorPolicy: 'stop',
        upsertFields: ['_id'],
      }],
    });
    expect(result.success).toBe(false);
  });

  it('keeps transfer batches bounded', () => {
    expect(TRANSFER_MAX_BATCH_DOCUMENTS).toBe(500);
    expect(TRANSFER_MAX_BATCH_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe('file import mapping', () => {
  it('keeps ambiguous leading-zero values as strings during inference', () => {
    expect(inferColumnType('postalCode', ['00120', '00340'])).toBe('string');
    expect(inferColumnType('_id', ['507f1f77bcf86cd799439011'])).toBe('objectId');
    expect(inferColumnType('count', ['1', '20'])).toBe('int32');
  });

  it('creates nested paths while preserving explicitly literal dotted fields', () => {
    const mapped = mapFileRow({ city: 'Istanbul', dotted: 'literal', empty: '' }, [
      { sourceColumn: 'city', included: true, targetField: 'profile.city', type: 'string' },
      { sourceColumn: 'dotted', included: true, targetField: 'field.name', literalFieldName: true, type: 'string' },
      { sourceColumn: 'empty', included: true, targetField: 'empty', type: 'string' },
    ], 'omit');
    expect(mapped).toEqual({ profile: { city: 'Istanbul' }, 'field.name': 'literal' });
  });

  it('supports all loss-sensitive BSON mappings', () => {
    expect(convertColumnValue('8', 'int32')).toBeInstanceOf(Int32);
    expect(convertColumnValue('9223372036854775807', 'long')).toBeInstanceOf(Long);
    expect(convertColumnValue('1492.00', 'decimal128')).toBeInstanceOf(Decimal128);
    expect(convertColumnValue('507f1f77bcf86cd799439011', 'objectId')).toBeInstanceOf(ObjectId);
    expect(convertColumnValue('2026-08-09T00:00:00.000Z', 'date')).toEqual(new Date('2026-08-09T00:00:00.000Z'));
  });

  it('accepts safe Compass-style BSON values in JSON/EJSON cells', () => {
    const value = convertColumnValue('{ id: ObjectId("507f1f77bcf86cd799439011") }', 'json-ejson') as { id: ObjectId };
    expect(value.id).toBeInstanceOf(ObjectId);
  });

  it('does not expose a selected file path in progress errors', async () => {
    const secretPath = '/private/secret/customer-data.csv';
    const terminal = new Promise<string>((resolve) => {
      const manager = new FileImportManager((event) => {
        if (event.status === 'failed') resolve(event.message ?? '');
      });
      manager.start({} as MongoClient, 'target', [{
        path: secretPath,
        fileName: 'customer-data.csv',
        fileToken: '123e4567-e89b-12d3-a456-426614174000',
        targetDatabase: 'db',
        targetCollection: 'items',
        mappings: [{ sourceColumn: 'name', included: true, targetField: 'name', type: 'string' }],
        emptyCellPolicy: 'omit',
        conflictMode: 'insert-stop',
        rowErrorPolicy: 'stop',
        upsertFields: ['_id'],
      }]);
    });
    const message = await terminal;
    expect(message).not.toContain(secretPath);
    expect(message).toContain('[selected file]');
  });
});

function copyDataset() {
  return {
    sourceDatabase: 'db',
    sourceCollection: 'items',
    targetDatabase: 'db',
    targetCollection: 'items',
    filterSource: '{}',
    conflictMode: 'insert-stop',
    rowErrorPolicy: 'stop',
    upsertFields: ['_id'],
    metadata: { collectionOptions: false, validationRules: false, indexes: false },
  };
}
