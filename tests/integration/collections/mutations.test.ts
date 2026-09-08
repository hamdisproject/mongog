import { BSONRegExp, Decimal128, EJSON, Int32, Long, ObjectId, Timestamp } from 'bson';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bulkUpdateCollectionDocuments,
  countCollectionDocuments,
  deleteCollectionDocument,
  dropCollection,
  dropDatabase,
  findCollectionDocuments,
  insertCollectionDocument,
  renameCollection,
  replaceCollectionDocument,
} from '../../../src/query-runtime/collection/operations.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import { parseEjson, serializeToEjson } from '../../../src/shared/ejson/index.js';
import { isAppError } from '../../../src/shared/errors/index.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';

const suite = useMongoIntegrationSuite('collection mutations');
const DATABASE = suite.databaseName;

describe('collection browser operations', () => {
  let client: MongoClient;
  let registry: CursorRegistry;

  beforeAll(async () => {
    client = await suite.newClient(suite.standaloneUri);
    registry = new CursorRegistry();
  }, 120_000);

  afterAll(async () => {
    await registry.dispose();
  });

  it('applies Compass-style BSON filters and document mutations with type preservation', async () => {
    const id = '507f1f77bcf86cd799439011';
    await insertCollectionDocument(client!, {
      database: DATABASE,
      collection: 'compass_literals',
      documentEjson: `{
        _id: ObjectId("${id}"),
        createdAt: ISODate("2026-01-02T03:04:05.006Z"),
        sequence: Long("9223372036854775807"),
        amount: Decimal128("125.50"),
        name: "bike-alpha",
        matcher: BSONRegExp("^bike", "i"),
        clock: Timestamp({ t: 1700000000, i: 1 }),
      }`,
    });

    const stored = await client!.db(DATABASE).collection('compass_literals').findOne({
      _id: new ObjectId(id),
    });
    expect((stored?._id as { _bsontype?: string })._bsontype).toBe('ObjectId');
    await expect(client!.db(DATABASE)
      .collection<{ _id: ObjectId | string }>('compass_literals')
      .findOne({ _id: id }))
      .resolves.toBeNull();
    expect(stored?.createdAt).toBeInstanceOf(Date);
    expect((stored?.sequence as { _bsontype?: string })._bsontype).toBe('Long');
    expect((stored?.amount as { _bsontype?: string })._bsontype).toBe('Decimal128');
    expect(EJSON.stringify(stored?.matcher, undefined, 0, { relaxed: false })).toContain('$regularExpression');
    expect((stored?.clock as { _bsontype?: string })._bsontype).toBe('Timestamp');

    const page = await findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'compass_literals',
      owner: { connectionId: 'phase3', tabId: 'compass-literals-tab' },
      filterEjson: `{
        _id: ObjectId("${id}"),
        createdAt: { $gte: ISODate("2026-01-01T00:00:00.000Z") },
        sequence: Long("9223372036854775807"),
        amount: Decimal128("125.50"),
        name: /^bike/i,
        clock: Timestamp({ t: 1700000000, i: 1 }),
      }`,
      pageSize: 10,
    });
    expect(page.documents).toHaveLength(1);

    await replaceCollectionDocument(client!, {
      database: DATABASE,
      collection: 'compass_literals',
      originalDocumentEjson: serializeToEjson(stored).ejson,
      documentEjson: `{
        _id: ObjectId("${id}"),
        createdAt: ISODate("2026-01-03T00:00:00.000Z"),
        sequence: Long("42"),
        amount: Decimal128("250.75"),
        name: "bike-updated",
      }`,
    });
    const replaced = await client!.db(DATABASE).collection('compass_literals').findOne({
      _id: new ObjectId(id),
    });
    expect((replaced?.sequence as Long).toString()).toBe('42');
    expect((replaced?.amount as Decimal128).toString()).toBe('250.75');
  });

  it('counts the applied safe filter without consuming the browser cursor', async () => {
    await client!.db(DATABASE).collection('criteria_count').insertMany([
      { bikeid: 17827, rank: 1 },
      { bikeid: 17827, rank: 3 },
      { bikeid: 99, rank: 2 },
    ]);
    const result = await countCollectionDocuments(client!, {
      database: DATABASE,
      collection: 'criteria_count',
      filterEjson: '{ bikeid: 17827, rank: { $gte: 2 } }',
    });
    expect(result).toEqual({ count: 1 });
  });

  it('renames and drops collections and drops a database through driver operations', async () => {
    const database = `${DATABASE}_namespace_mutations`;
    await client!.db(database).collection('before').insertOne({ value: 1 });
    await expect(renameCollection(client!, {
      database,
      collection: 'before',
      newName: 'after',
    })).resolves.toEqual({ oldName: 'before', newName: 'after' });
    await expect(client!.db(database).collection('after').countDocuments({})).resolves.toBe(1);
    await expect(dropCollection(client!, { database, collection: 'after' }))
      .resolves.toEqual({ dropped: true });
    await client!.db(database).collection('remaining').insertOne({ value: 2 });
    await expect(dropDatabase(client!, database)).resolves.toEqual({ dropped: true });
    const names = (await client!.db('admin').admin().listDatabases()).databases.map((item) => item.name);
    expect(names).not.toContain(database);
  });

  it('rejects executable criteria before they reach MongoDB', async () => {
    await expect(findCollectionDocuments(client!, registry!, {
      database: DATABASE,
      collection: 'criteria',
      owner: { connectionId: 'phase3', tabId: 'unsafe-criteria-tab' },
      filterEjson: '{ bikeid: getBikeId() }',
      pageSize: 10,
    })).rejects.toMatchObject({ category: 'Validation' });
  });

  it('replaces a BSON-rich document while preserving its immutable _id', async () => {
    const id = new ObjectId();
    const inserted = await insertCollectionDocument(client!, {
      database: DATABASE,
      collection: 'mutations',
      documentEjson: EJSON.stringify({ _id: id, value: 1 }, undefined, 0, { relaxed: false }),
    });
    expect(parseEjson<ObjectId>(inserted.insertedId!).equals(id)).toBe(true);

    const original = await client!.db(DATABASE).collection('mutations').findOne({ _id: id });
    const replacement = { ...original, value: 2, nested: { enabled: true } };
    const result = await replaceCollectionDocument(client!, {
      database: DATABASE,
      collection: 'mutations',
      originalDocumentEjson: serializeToEjson(original).ejson,
      documentEjson: serializeToEjson(replacement).ejson,
    });
    expect(result).toMatchObject({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });
    await expect(client!.db(DATABASE).collection('mutations').findOne({ _id: id }))
      .resolves.toMatchObject({ value: 2, nested: { enabled: true } });
  });

  it('rejects stale replacements instead of overwriting a concurrent change', async () => {
    const collection = client!.db(DATABASE).collection('stale');
    const { insertedId } = await collection.insertOne({ value: 'original' });
    const original = await collection.findOne({ _id: insertedId });
    await collection.updateOne({ _id: insertedId }, { $set: { value: 'concurrent' } });

    await expect(replaceCollectionDocument(client!, {
      database: DATABASE,
      collection: 'stale',
      originalDocumentEjson: serializeToEjson(original).ejson,
      documentEjson: serializeToEjson({ ...original, value: 'mine' }).ejson,
    })).rejects.toMatchObject({ category: 'StaleDocument' });
    await expect(collection.findOne({ _id: insertedId })).resolves.toMatchObject({ value: 'concurrent' });
  });

  it('sets and removes one field across selected documents with BSON preservation', async () => {
    const collection = client!.db(DATABASE).collection('bulk_fields');
    await collection.deleteMany({});
    await collection.insertMany([
      { label: 'a', profile: { active: true } },
      { label: 'b', profile: { active: false } },
      { label: 'c' },
    ]);
    const originals = await collection.find({}).sort({ label: 1 }).toArray();
    const setResult = await bulkUpdateCollectionDocuments(client!, {
      database: DATABASE,
      collection: 'bulk_fields',
      originalDocumentsEjson: originals.map((document) => serializeToEjson(document).ejson),
      change: {
        kind: 'field',
        path: 'profile.score',
        operation: 'set',
        valueEjson: 'Decimal128("12.50")',
      },
    });
    expect(setResult).toMatchObject({
      requestedCount: 3,
      matchedCount: 3,
      modifiedCount: 3,
      unchangedCount: 0,
      failedCount: 0,
    });
    const afterSet = await collection.find({}).sort({ label: 1 }).toArray();
    expect(afterSet.every((document) => document.profile.score?._bsontype === 'Decimal128')).toBe(true);

    const unsetResult = await bulkUpdateCollectionDocuments(client!, {
      database: DATABASE,
      collection: 'bulk_fields',
      originalDocumentsEjson: afterSet.map((document) => serializeToEjson(document).ejson),
      change: { kind: 'field', path: 'profile.active', operation: 'unset' },
    });
    expect(unsetResult).toMatchObject({ matchedCount: 3, modifiedCount: 2, unchangedCount: 1 });
    const afterUnset = await collection.find({}).toArray();
    expect(afterUnset.every((document) => !Object.hasOwn(document.profile, 'active'))).toBe(true);
  });

  it('replaces selected documents by immutable id regardless of edited array order', async () => {
    const collection = client!.db(DATABASE).collection('bulk_replace');
    await collection.deleteMany({});
    await collection.insertMany([{ value: 'first' }, { value: 'second' }]);
    const originals = await collection.find({}).sort({ value: 1 }).toArray();
    const replacements = [
      { ...originals[1], value: 'second-updated', typed: Long.fromString('42') },
      { ...originals[0], value: 'first-updated', typed: Long.fromString('7') },
    ];
    const result = await bulkUpdateCollectionDocuments(client!, {
      database: DATABASE,
      collection: 'bulk_replace',
      originalDocumentsEjson: originals.map((document) => serializeToEjson(document).ejson),
      change: {
        kind: 'replace',
        documentsEjson: replacements.map((document) => serializeToEjson(document).ejson),
      },
    });
    expect(result).toMatchObject({ matchedCount: 2, modifiedCount: 2, failedCount: 0 });
    const stored = await collection.find({}).sort({ value: 1 }).toArray();
    expect(stored.map((document) => document.value)).toEqual(['first-updated', 'second-updated']);
    // Small int64 values may be promoted to JavaScript numbers by the driver's
    // default BSON deserializer. Re-serialize to confirm the stored BSON type.
    const canonicalStored = await collection.find({}, { promoteLongs: false }).sort({ value: 1 }).toArray();
    expect(canonicalStored.every((document) => document.typed?._bsontype === 'Long')).toBe(true);
  });

  it('continues bulk updates and reports stale and missing documents per row', async () => {
    const collection = client!.db(DATABASE).collection('bulk_conflicts');
    await collection.deleteMany({});
    await collection.insertMany([{ slot: 1 }, { slot: 2 }, { slot: 3 }]);
    const originals = await collection.find({}).sort({ slot: 1 }).toArray();
    await collection.updateOne({ _id: originals[0]!._id }, { $set: { concurrent: true } });
    await collection.deleteOne({ _id: originals[1]!._id });

    const result = await bulkUpdateCollectionDocuments(client!, {
      database: DATABASE,
      collection: 'bulk_conflicts',
      originalDocumentsEjson: originals.map((document) => serializeToEjson(document).ejson),
      change: { kind: 'field', path: 'status', operation: 'set', valueEjson: '"updated"' },
    });
    expect(result).toMatchObject({
      requestedCount: 3,
      matchedCount: 1,
      modifiedCount: 1,
      failedCount: 2,
    });
    expect(result.items[0]).toMatchObject({ status: 'error', error: { category: 'StaleDocument' } });
    expect(result.items[1]).toMatchObject({ status: 'error', error: { category: 'NotFound' } });
    expect(result.items[2]).toMatchObject({ status: 'success', modified: true });
    await expect(collection.findOne({ _id: originals[2]!._id })).resolves.toMatchObject({ status: 'updated' });
  });

  it('validates a full replacement batch before writing any selected document', async () => {
    const collection = client!.db(DATABASE).collection('bulk_prevalidation');
    await collection.deleteMany({});
    await collection.insertMany([{ value: 1 }, { value: 2 }]);
    const originals = await collection.find({}).sort({ value: 1 }).toArray();
    await expect(bulkUpdateCollectionDocuments(client!, {
      database: DATABASE,
      collection: 'bulk_prevalidation',
      originalDocumentsEjson: originals.map((document) => serializeToEjson(document).ejson),
      change: {
        kind: 'replace',
        documentsEjson: [
          serializeToEjson({ ...originals[0], value: 10 }).ejson,
          serializeToEjson({ _id: new ObjectId(), value: 20 }).ejson,
        ],
      },
    })).rejects.toMatchObject({ category: 'Validation' });
    await expect(collection.find({}).sort({ value: 1 }).toArray())
      .resolves.toMatchObject([{ value: 1 }, { value: 2 }]);
  });
});
