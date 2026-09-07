import type { Document, MongoClient } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import {
  createDatabase,
  moveDatabaseCollection,
  preflightDatabaseRename,
} from '../../../src/query-runtime/database/operations.js';

interface FakeMongoOptions {
  databaseNames?: string[];
  collections?: Document[];
  hello?: Document;
  renameError?: Error;
}

function fakeMongo(options: FakeMongoOptions = {}) {
  const collectionRows = [...(options.collections ?? [])];
  const createCollection = vi.fn().mockResolvedValue({});
  const close = vi.fn().mockResolvedValue(undefined);
  const next = vi.fn(async () => collectionRows.shift() ?? null);
  const listCollections = vi.fn(() => ({ next, close }));
  const command = vi.fn(async (value: Document) => {
    if (value.hello === 1) return options.hello ?? { ok: 1 };
    if (value.listDatabases === 1) {
      return { databases: (options.databaseNames ?? ['source']).map((name) => ({ name })) };
    }
    if (value.renameCollection && options.renameError) throw options.renameError;
    return { ok: 1 };
  });
  const db = vi.fn((name: string) => (
    name === 'admin'
      ? { command }
      : { createCollection, listCollections }
  ));
  return {
    client: { db } as unknown as MongoClient,
    command,
    createCollection,
    listCollections,
    next,
    close,
  };
}

describe('database create operation', () => {
  it('creates the first collection only when the database does not exist', async () => {
    const mongo = fakeMongo({ databaseNames: ['admin', 'other'] });
    await expect(createDatabase(mongo.client, 'new_app', 'items')).resolves.toEqual({
      database: 'new_app',
      collection: 'items',
    });
    expect(mongo.createCollection).toHaveBeenCalledWith('items');
  });

  it('rejects a case-insensitive existing database without creating a collection', async () => {
    const mongo = fakeMongo({ databaseNames: ['Existing'] });
    await expect(createDatabase(mongo.client, 'existing', 'items')).rejects.toMatchObject({
      category: 'Validation',
    });
    expect(mongo.createCollection).not.toHaveBeenCalled();
  });
});

describe('database rename preflight', () => {
  it('returns only normal collections in alphabetical order and disables operation timeouts', async () => {
    const mongo = fakeMongo({
      databaseNames: ['source'],
      collections: [
        { name: 'zeta', type: 'collection', options: {} },
        { name: 'alpha', type: 'collection', options: {} },
      ],
    });
    await expect(preflightDatabaseRename(mongo.client, 'source', 'target')).resolves.toEqual({
      collections: ['alpha', 'zeta'],
    });
    expect(mongo.command).toHaveBeenCalledWith({ hello: 1 }, { timeoutMS: 0 });
    expect(mongo.command).toHaveBeenCalledWith(
      { listDatabases: 1, nameOnly: true },
      { timeoutMS: 0 },
    );
    expect(mongo.listCollections).toHaveBeenCalledWith({}, { nameOnly: false, timeoutMS: 0 });
    expect(mongo.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['view', { name: 'report', type: 'view', options: {} }],
    ['time-series', { name: 'metrics', type: 'collection', options: { timeseries: { timeField: 'at' } } }],
    ['system', { name: 'system.profile', type: 'collection', options: {} }],
    ['Queryable Encryption state', { name: 'enxcol_.customers.esc', type: 'collection', options: {} }],
    ['Queryable Encryption metadata', { name: 'customers', type: 'collection', options: { encryptedFields: {} } }],
  ])('rejects a %s namespace before any move command', async (_label, collection) => {
    const mongo = fakeMongo({ databaseNames: ['source'], collections: [collection] });
    await expect(preflightDatabaseRename(mongo.client, 'source', 'target')).rejects.toMatchObject({
      category: 'Validation',
    });
    expect(mongo.command.mock.calls.some(([value]) => Boolean((value as Document).renameCollection))).toBe(false);
    expect(mongo.close).toHaveBeenCalledOnce();
  });

  it('rejects mongos before inspecting or changing namespaces', async () => {
    const mongo = fakeMongo({
      databaseNames: ['source'],
      collections: [{ name: 'items', type: 'collection' }],
      hello: { ok: 1, msg: 'isdbgrid' },
    });
    await expect(preflightDatabaseRename(mongo.client, 'source', 'target')).rejects.toMatchObject({
      category: 'Validation',
      message: expect.stringContaining('sharded'),
    });
    expect(mongo.listCollections).not.toHaveBeenCalled();
  });

  it.each([
    ['missing source', [], 'source', 'target', 'no longer exists'],
    ['existing target', ['source', 'TARGET'], 'source', 'target', 'already exists'],
    ['same name', ['source'], 'source', 'SOURCE', 'different'],
    ['protected source', ['admin'], 'admin', 'target', 'reserved'],
  ])('rejects %s', async (_label, databaseNames, source, target, message) => {
    const mongo = fakeMongo({ databaseNames, collections: [{ name: 'items', type: 'collection' }] });
    await expect(preflightDatabaseRename(mongo.client, source, target)).rejects.toMatchObject({
      message: expect.stringContaining(message),
    });
    expect(mongo.command.mock.calls.some(([value]) => Boolean((value as Document).renameCollection))).toBe(false);
  });

  it('rejects an empty source database', async () => {
    const mongo = fakeMongo({ databaseNames: ['source'], collections: [] });
    await expect(preflightDatabaseRename(mongo.client, 'source', 'target')).rejects.toMatchObject({
      category: 'Validation',
      message: expect.stringContaining('no collections'),
    });
  });
});

describe('database collection move', () => {
  it('uses admin.renameCollection with dropTarget false and no command timeout', async () => {
    const mongo = fakeMongo();
    await moveDatabaseCollection(mongo.client, 'source', 'target', 'items');
    expect(mongo.command).toHaveBeenCalledWith({
      renameCollection: 'source.items',
      to: 'target.items',
      dropTarget: false,
    }, { timeoutMS: 0 });
  });
});
