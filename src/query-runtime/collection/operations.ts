import { EJSON } from 'bson';
import type { Collection, Document, Filter, MongoClient, Sort } from 'mongodb';
import type {
  CollectionDocumentsPage,
  CollectionMutationResult,
} from '../../shared/domain/index.js';
import { serializeToEjson } from '../../shared/ejson/index.js';
import { appError } from '../../shared/errors/index.js';
import {
  DocumentExpressionError,
  parseDocumentExpression,
} from '../../features/script-analysis/index.js';
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

export interface CollectionCountOptions extends CollectionNamespace {
  filterEjson: string;
}

export interface CollectionRenameOptions extends CollectionNamespace {
  newName: string;
}

export async function findCollectionDocuments(
  client: MongoClient,
  registry: CursorRegistry,
  options: CollectionFindOptions,
): Promise<CollectionDocumentsPage> {
  const filter = parseQueryDocumentExpression(options.filterEjson, 'Filter');
  const sort = options.sortEjson
    ? parseQueryDocumentExpression(options.sortEjson, 'Sort')
    : undefined;
  const projection = options.projectionEjson
    ? parseQueryDocumentExpression(options.projectionEjson, 'Projection')
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

export async function countCollectionDocuments(
  client: MongoClient,
  options: CollectionCountOptions,
): Promise<{ count: number }> {
  const filter = parseQueryDocumentExpression(options.filterEjson, 'Filter');
  const count = await client
    .db(options.database)
    .collection(options.collection)
    // Exact counts on large or weakly indexed filtered collections can take
    // longer than the browser page request. Keep this below the runtime IPC
    // ceiling while avoiding the former, surprisingly short 30 second cap.
    .countDocuments(filter as Filter<Document>, { maxTimeMS: 110_000 });
  return { count };
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

export async function renameCollection(
  client: MongoClient,
  options: CollectionRenameOptions,
): Promise<{ oldName: string; newName: string }> {
  if (options.newName === options.collection) {
    throw appError('Validation', 'The new collection name must be different.');
  }
  await client
    .db(options.database)
    .collection(options.collection)
    .rename(options.newName, { dropTarget: false });
  return { oldName: options.collection, newName: options.newName };
}

export async function dropCollection(
  client: MongoClient,
  options: CollectionNamespace,
): Promise<{ dropped: boolean }> {
  const dropped = await client.db(options.database).collection(options.collection).drop();
  return { dropped };
}

export async function dropDatabase(
  client: MongoClient,
  database: string,
): Promise<{ dropped: boolean }> {
  const dropped = await client.db(database).dropDatabase();
  return { dropped };
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

/** Collection browser criteria accept safe JS-style object literals. */
export function parseQueryDocumentExpression(source: string, label: string): Document {
  let json: string;
  try {
    json = parseDocumentExpression(source, label).json;
  } catch (error) {
    if (error instanceof DocumentExpressionError) {
      throw appError('Validation', error.message, {
        hint: `Invalid criteria range: characters ${error.start + 1}-${error.end}.`,
      });
    }
    throw error;
  }

  assertNoExecutableCriteriaOperators(JSON.parse(json) as unknown, label);
  let value: unknown;
  try {
    value = EJSON.parse(json, { relaxed: false });
  } catch (error) {
    throw appError('Validation', `${label} contains invalid Extended JSON data.`, {
      name: (error as Error).name,
      causeMessage: (error as Error).message,
    });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw appError('Validation', `${label} must be an object literal.`);
  }
  return value as Document;
}

const EXECUTABLE_CRITERIA_OPERATORS = new Set(['$where', '$function', '$accumulator']);

function assertNoExecutableCriteriaOperators(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoExecutableCriteriaOperators(item, label);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, nested] of Object.entries(value)) {
    if (EXECUTABLE_CRITERIA_OPERATORS.has(key)) {
      throw appError(
        'Validation',
        `${label} does not allow the executable MongoDB operator ${key}.`,
      );
    }
    assertNoExecutableCriteriaOperators(nested, label);
  }
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
