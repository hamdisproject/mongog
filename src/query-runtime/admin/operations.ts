import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { EJSON, ObjectId } from 'bson';
import {
  GridFSBucket,
  type Document,
  type IndexDescriptionInfo,
  type IndexSpecification,
  type MongoClient,
} from 'mongodb';
import type {
  ChangeStreamPollResult,
  ChangeStreamStartResult,
  ExplainVerbosity,
  GlobalSearchResult,
  GridFsFileInfo,
  GridFsUploadResult,
  IndexDescription,
} from '../../shared/domain/index.js';
import { serializeToEjson } from '../../shared/ejson/index.js';
import { appError } from '../../shared/errors/index.js';
import { parseEjsonDocument } from '../collection/operations.js';
import { CursorRegistry, type CursorOwner } from '../registry/cursors.js';

export interface AdminNamespace {
  database: string;
  collection: string;
}

export async function listIndexes(
  client: MongoClient,
  namespace: AdminNamespace,
): Promise<IndexDescription[]> {
  const cursor = client.db(namespace.database).collection(namespace.collection).listIndexes();
  const indexes: IndexDescription[] = [];
  try {
    for (;;) {
      const index = await cursor.next();
      if (!index) break;
      indexes.push(indexDescription(index));
    }
  } finally {
    await cursor.close().catch(() => undefined);
  }
  return indexes;
}

export async function createCollectionIndex(
  client: MongoClient,
  options: AdminNamespace & {
    keysEjson: string;
    name?: string;
    unique?: boolean;
    sparse?: boolean;
    hidden?: boolean;
    expireAfterSeconds?: number;
    partialFilterEjson?: string;
  },
): Promise<{ name: string }> {
  const keys = parseEjsonDocument(options.keysEjson, 'Index keys');
  if (Object.keys(keys).length === 0) {
    throw appError('Validation', 'Index keys must contain at least one field.');
  }
  const partialFilterExpression = options.partialFilterEjson
    ? parseEjsonDocument(options.partialFilterEjson, 'Partial filter')
    : undefined;
  const name = await client.db(options.database).collection(options.collection).createIndex(
    keys as IndexSpecification,
    {
      ...(options.name ? { name: options.name } : {}),
      ...(options.unique !== undefined ? { unique: options.unique } : {}),
      ...(options.sparse !== undefined ? { sparse: options.sparse } : {}),
      ...(options.hidden !== undefined ? { hidden: options.hidden } : {}),
      ...(options.expireAfterSeconds !== undefined
        ? { expireAfterSeconds: options.expireAfterSeconds }
        : {}),
      ...(partialFilterExpression ? { partialFilterExpression } : {}),
    },
  );
  return { name };
}

export async function dropCollectionIndex(
  client: MongoClient,
  options: AdminNamespace & { name: string },
): Promise<{ dropped: string }> {
  if (options.name === '_id_') {
    throw appError('Validation', 'The required _id_ index cannot be dropped.');
  }
  await client.db(options.database).collection(options.collection).dropIndex(options.name);
  return { dropped: options.name };
}

export async function explainCollectionFind(
  client: MongoClient,
  options: AdminNamespace & {
    filterEjson: string;
    sortEjson?: string;
    projectionEjson?: string;
    verbosity: ExplainVerbosity;
  },
) {
  const filter = parseEjsonDocument(options.filterEjson, 'Filter');
  const sort = options.sortEjson
    ? parseEjsonDocument(options.sortEjson, 'Sort')
    : undefined;
  const projection = options.projectionEjson
    ? parseEjsonDocument(options.projectionEjson, 'Projection')
    : undefined;
  let cursor = client.db(options.database).collection(options.collection).find(filter, {
    ...(projection ? { projection } : {}),
    maxTimeMS: 30_000,
  });
  if (sort && Object.keys(sort).length > 0) cursor = cursor.sort(sort);
  const result = await cursor.explain(options.verbosity);
  return serializeToEjson(result, 2 * 1024 * 1024);
}

export async function globalSearch(
  client: MongoClient,
  options: {
    database: string;
    text: string;
    maxCollections: number;
    maxDocumentsPerCollection: number;
    maxResults: number;
  },
): Promise<GlobalSearchResult> {
  const needle = options.text.trim().toLocaleLowerCase();
  if (!needle) throw appError('Validation', 'Search text cannot be empty.');

  const database = client.db(options.database);
  const collectionsCursor = database.listCollections({}, { nameOnly: false });
  const collectionNames: string[] = [];
  try {
    while (collectionNames.length < options.maxCollections) {
      const info = await collectionsCursor.next();
      if (!info) break;
      if (info.type === 'collection' && !info.name.startsWith('system.')) {
        collectionNames.push(info.name);
      }
    }
  } finally {
    await collectionsCursor.close().catch(() => undefined);
  }

  const matches: GlobalSearchResult['matches'] = [];
  let scannedDocuments = 0;
  let scannedCollections = 0;
  let truncated = false;

  for (const collectionName of collectionNames) {
    scannedCollections += 1;
    const cursor = database.collection(collectionName).find({}).limit(options.maxDocumentsPerCollection);
    try {
      for (;;) {
        const document = await cursor.next();
        if (!document) break;
        scannedDocuments += 1;
        const canonical = EJSON.stringify(document, undefined, 0, { relaxed: false });
        if (canonical.toLocaleLowerCase().includes(needle)) {
          matches.push({ collection: collectionName, document: serializeToEjson(document) });
          if (matches.length >= options.maxResults) {
            truncated = true;
            break;
          }
        }
      }
    } finally {
      await cursor.close().catch(() => undefined);
    }
    if (truncated) break;
  }

  return {
    matches,
    scannedCollections,
    scannedDocuments,
    maxDocumentsPerCollection: options.maxDocumentsPerCollection,
    truncated,
    sampled: true,
  };
}

export function startChangeStream(
  client: MongoClient,
  registry: CursorRegistry,
  options: {
    database: string;
    collection?: string;
    pipelineEjson: string;
    fullDocument: 'default' | 'updateLookup' | 'whenAvailable' | 'required';
    owner: CursorOwner;
  },
): ChangeStreamStartResult {
  const pipeline = parseEjsonArray(options.pipelineEjson, 'Change stream pipeline');
  const watchOptions = { fullDocument: options.fullDocument, maxAwaitTimeMS: 1_000 } as const;
  const stream = options.collection
    ? client.db(options.database).collection(options.collection).watch(pipeline, watchOptions)
    : client.db(options.database).watch(pipeline, watchOptions);
  return { streamId: registry.registerStream(stream, options.owner) };
}

export async function pollChangeStream(
  registry: CursorRegistry,
  streamId: string,
  maxEvents: number,
): Promise<ChangeStreamPollResult> {
  return registry.pollStream(streamId, maxEvents);
}

export async function listGridFsFiles(
  client: MongoClient,
  options: { database: string; bucketName: string; limit: number },
): Promise<GridFsFileInfo[]> {
  const bucket = new GridFSBucket(client.db(options.database), { bucketName: options.bucketName });
  const cursor = bucket.find({}).sort({ uploadDate: -1 }).limit(options.limit);
  const files: GridFsFileInfo[] = [];
  try {
    for (;;) {
      const file = await cursor.next();
      if (!file) break;
      files.push({
        id: serializeToEjson(file._id),
        filename: file.filename,
        length: Number(file.length),
        chunkSize: file.chunkSize,
        uploadDate: file.uploadDate.toISOString(),
        ...(file.metadata ? { metadata: serializeToEjson(file.metadata) } : {}),
      });
    }
  } finally {
    await cursor.close().catch(() => undefined);
  }
  return files;
}

export async function uploadGridFsFile(
  client: MongoClient,
  options: {
    database: string;
    bucketName: string;
    sourcePath: string;
    metadataEjson?: string;
  },
): Promise<GridFsUploadResult> {
  const metadata = options.metadataEjson
    ? parseEjsonDocument(options.metadataEjson, 'GridFS metadata')
    : undefined;
  const bucket = new GridFSBucket(client.db(options.database), { bucketName: options.bucketName });
  const sourceInfo = await stat(options.sourcePath);
  if (!sourceInfo.isFile()) throw appError('Validation', 'The selected GridFS source is not a file.');
  const filename = basename(options.sourcePath);
  const upload = bucket.openUploadStream(filename, { ...(metadata ? { metadata } : {}) });
  await pipeline(createReadStream(options.sourcePath), upload);
  return { id: serializeToEjson(upload.id), filename, length: sourceInfo.size };
}

export async function downloadGridFsFile(
  client: MongoClient,
  options: { database: string; bucketName: string; idEjson: string; destinationPath: string },
): Promise<{ downloaded: true }> {
  const bucket = new GridFSBucket(client.db(options.database), { bucketName: options.bucketName });
  const id = parseObjectId(options.idEjson);
  await pipeline(bucket.openDownloadStream(id), createWriteStream(options.destinationPath));
  return { downloaded: true };
}

export async function deleteGridFsFile(
  client: MongoClient,
  options: { database: string; bucketName: string; idEjson: string },
): Promise<{ deleted: true }> {
  const bucket = new GridFSBucket(client.db(options.database), { bucketName: options.bucketName });
  await bucket.delete(parseObjectId(options.idEjson));
  return { deleted: true };
}

function indexDescription(index: IndexDescriptionInfo): IndexDescription {
  return {
    name: index.name ?? '<unnamed>',
    key: serializeToEjson(index.key),
    unique: index.unique === true,
    sparse: index.sparse === true,
    hidden: index.hidden === true,
    ...(typeof index.expireAfterSeconds === 'number'
      ? { expireAfterSeconds: index.expireAfterSeconds }
      : {}),
    ...(index.partialFilterExpression
      ? { partialFilterExpression: serializeToEjson(index.partialFilterExpression) }
      : {}),
  };
}

function parseEjsonArray(ejson: string, label: string): Document[] {
  let value: unknown;
  try {
    value = EJSON.parse(ejson, { relaxed: false });
  } catch (error) {
    throw appError('Validation', `${label} is not valid Extended JSON.`, {
      causeMessage: (error as Error).message,
    });
  }
  if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
    throw appError('Validation', `${label} must be an array of objects.`);
  }
  return value as Document[];
}

function parseObjectId(ejson: string): ObjectId {
  let value: unknown;
  try {
    value = EJSON.parse(ejson, { relaxed: false });
  } catch (error) {
    throw appError('Validation', 'GridFS file id is not valid Extended JSON.', {
      causeMessage: (error as Error).message,
    });
  }
  if (!(value instanceof ObjectId)) {
    throw appError('Validation', 'GridFS file id must be an ObjectId.');
  }
  return value;
}
