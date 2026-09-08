import { EJSON, ObjectId } from 'bson';
import type { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  findCollectionDocuments,
  insertCollectionDocument,
} from '../../../src/query-runtime/collection/operations.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import { parseEjson } from '../../../src/shared/ejson/index.js';
import { editorBsonCases } from '../../fixtures/bson-editor-corpus.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';

const suite = useMongoIntegrationSuite('collection bson types');
const COLLECTION = 'bson_type_round_trip';
const canonical = (value: unknown) => EJSON.stringify(value, undefined, 0, { relaxed: false });

describe('collection document BSON type round-trip', () => {
  let client: MongoClient;
  let registry: CursorRegistry;

  beforeAll(async () => {
    client = await suite.newClient(suite.standaloneUri);
    registry = new CursorRegistry();
  }, 120_000);

  afterAll(async () => {
    await registry.dispose();
  });

  it.each(editorBsonCases)('inserts and reads $name without type loss', async ({ source, expected }) => {
    const id = new ObjectId();
    const result = await insertCollectionDocument(client, {
      database: suite.databaseName,
      collection: COLLECTION,
      documentEjson: `{ _id: ObjectId("${id.toHexString()}"), value: ${source} }`,
    });

    expect(canonical(parseEjson(result.insertedId!))).toBe(canonical(id));
    const page = await findCollectionDocuments(client, registry, {
      database: suite.databaseName,
      collection: COLLECTION,
      owner: { connectionId: 'bson-types', tabId: 'round-trip' },
      filterEjson: EJSON.stringify({ _id: id }, undefined, 0, { relaxed: false }),
      pageSize: 1,
    });
    expect(page.documents).toHaveLength(1);
    const stored = parseEjson<Record<string, unknown>>(page.documents[0]!);
    expect(canonical(stored.value)).toBe(canonical(expected));
  });

  it('returns and persists an automatically generated ObjectId', async () => {
    const result = await insertCollectionDocument(client, {
      database: suite.databaseName,
      collection: COLLECTION,
      documentEjson: '{ marker: "automatic-id" }',
    });
    const insertedId = parseEjson<ObjectId>(result.insertedId!);
    const stored = await client.db(suite.databaseName).collection(COLLECTION)
      .findOne({ _id: insertedId });

    expect(canonical(insertedId)).toContain('$oid');
    expect(stored).toMatchObject({ marker: 'automatic-id' });
    expect(canonical(stored?._id)).toBe(canonical(insertedId));
  });

  it('does not match an ObjectId document with the same hexadecimal string', async () => {
    const id = new ObjectId();
    await insertCollectionDocument(client, {
      database: suite.databaseName,
      collection: COLLECTION,
      documentEjson: `{ _id: ObjectId("${id.toHexString()}"), marker: "typed-id" }`,
    });
    const collection = client.db(suite.databaseName)
      .collection<{ _id: ObjectId | string; marker?: string }>(COLLECTION);

    await expect(collection.findOne({ _id: id })).resolves.toMatchObject({ marker: 'typed-id' });
    await expect(collection.findOne({ _id: id.toHexString() })).resolves.toBeNull();
  });
});
