import { EJSON } from 'bson';
import type { Collection, Document, Filter, MongoClient, Sort } from 'mongodb';
import type {
  CollectionDocumentsPage,
  CollectionMutationResult,
} from '../../shared/domain/index.js';
import { serializeToEjson } from '../../shared/ejson/index.js';
import { appError } from '../../shared/errors/index.js';
import { CursorRegistry, type CursorOwner } from '../registry/cursors.js';

export interface CollectionNamespace {
  database: string;
  collection: string;
}

export interface CollectionFindOptions extends CollectionNamespace {
  owner: CursorOwner;
  filterEjson: string;
  sortEjson?: string;
  projectionEjson?: string;
  pageSize: number;
}

export interface CollectionInsertOptions extends CollectionNamespace {
  documentEjson: string;
}

export interface CollectionReplaceOptions extends CollectionNamespace {
  originalDocumentEjson: string;
  documentEjson: string;
}

export interface CollectionDeleteOptions extends CollectionNamespace {
  originalDocumentEjson: string;
}

export async function findCollectionDocuments(
  client: MongoClient,
  registry: CursorRegistry,
  options: CollectionFindOptions,
): Promise<CollectionDocumentsPage> {
  const filter = parseEjsonDocument(options.filterEjson, 'Filter');
  const sort = options.sortEjson
    ? parseEjsonDocument(options.sortEjson, 'Sort')
    : undefined;
  const projection = options.projectionEjson
    ? parseEjsonDocument(options.projectionEjson, 'Projection')
    : undefined;

  // One active browser cursor per tab. Re-applying a filter or refreshing
  // releases retained pages and oversized full-value handles from the old one.
  await registry.closeAllForOwner(options.owner);

  const collection = client.db(options.database).collection(options.collection);
  let cursor = collection.find(filter as Filter<Document>, {
    ...(projection ? { projection } : {}),
    maxTimeMS: 30_000,
  });
  if (sort && Object.keys(sort).length > 0) cursor = cursor.sort(sort as Sort);

  const cursorId = registry.register(
    cursor,
    options.owner,
    `${options.database}.${options.collection}`,
  );
  try {
    const page = await registry.fetchNext(cursorId, options.pageSize);
    return { ...page, cursorId, pageSize: options.pageSize };
  } catch (error) {
    await registry.close(cursorId);
    throw error;
  }
}

export async function insertCollectionDocument(
  client: MongoClient,
  options: CollectionInsertOptions,
): Promise<CollectionMutationResult> {
  const document = parseEjsonDocument(options.documentEjson, 'Document');
  const result = await client
    .db(options.database)
    .collection(options.collection)
    .insertOne(document);
  return {
    acknowledged: result.acknowledged,
    insertedId: serializeToEjson(result.insertedId),
  };
}

export async function replaceCollectionDocument(
  client: MongoClient,
  options: CollectionReplaceOptions,
): Promise<CollectionMutationResult> {
  const original = parseEjsonDocument(options.originalDocumentEjson, 'Original document');
  const replacement = parseEjsonDocument(options.documentEjson, 'Document');
  assertDocumentIdUnchanged(original, replacement);

  const collection = client.db(options.database).collection(options.collection);
  const result = await collection.replaceOne(optimisticFilter(original), replacement);
  if (result.matchedCount === 0) {
    await throwMutationConflict(collection, original);
  }
  return {
    acknowledged: result.acknowledged,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  };
}

export async function deleteCollectionDocument(
  client: MongoClient,
  options: CollectionDeleteOptions,
): Promise<CollectionMutationResult> {
  const original = parseEjsonDocument(options.originalDocumentEjson, 'Original document');
  assertDocumentHasId(original, 'Original document');

  const collection = client.db(options.database).collection(options.collection);
  const result = await collection.deleteOne(optimisticFilter(original));
  if (result.deletedCount === 0) {
    await throwMutationConflict(collection, original);
  }
  return {
    acknowledged: result.acknowledged,
    deletedCount: result.deletedCount,
  };
}

export function parseEjsonDocument(ejson: string, label: string): Document {
  let value: unknown;
  try {
    value = EJSON.parse(ejson, { relaxed: false });
  } catch (error) {
    throw appError('Validation', `${label} is not valid Extended JSON.`, {
      name: (error as Error).name,
      causeMessage: (error as Error).message,
    });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw appError('Validation', `${label} must be a JSON object.`);
  }
  return value as Document;
}

export function assertDocumentIdUnchanged(original: Document, replacement: Document): void {
  assertDocumentHasId(original, 'Original document');
  assertDocumentHasId(replacement, 'Replacement document');
  if (canonicalValue(original._id) !== canonicalValue(replacement._id)) {
    throw appError('Validation', 'The immutable _id field cannot be changed.');
  }
}

function assertDocumentHasId(document: Document, label: string): void {
  if (!Object.hasOwn(document, '_id')) {
    throw appError('Validation', `${label} must include an _id field.`);
  }
}

function canonicalValue(value: unknown): string {
  return EJSON.stringify(value, undefined, 0, { relaxed: false });
}

function optimisticFilter(original: Document): Filter<Document> {
  assertDocumentHasId(original, 'Original document');
  // Match both identity and the exact originally loaded document. The write is
  // atomic: a concurrent change turns the operation into StaleDocument rather
  // than silently overwriting someone else's update.
  return {
    _id: original._id,
    $expr: { $eq: ['$$ROOT', { $literal: original }] },
  } as Filter<Document>;
}

async function throwMutationConflict(
  collection: Collection<Document>,
  original: Document,
): Promise<never> {
  const existing = await collection.findOne(
    { _id: original._id } as Filter<Document>,
    { projection: { _id: 1 } },
  );
  if (existing) {
    throw appError(
      'StaleDocument',
      'The document changed after it was loaded. Refresh before applying this operation.',
    );
  }
  throw appError('NotFound', 'The document no longer exists.');
}
