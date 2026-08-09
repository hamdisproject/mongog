import { EJSON } from 'bson';
import type { Document, MongoClient } from 'mongodb';
import type { DataConflictMode, DataRowErrorPolicy } from '../../shared/domain/index.js';
import { appError, serializeError } from '../../shared/errors/index.js';

export const TRANSFER_MAX_BATCH_DOCUMENTS = 500;
export const TRANSFER_MAX_BATCH_BYTES = 8 * 1024 * 1024;

export interface TransferWriteRequest {
  database: string;
  collection: string;
  documentsEjson: string[];
  conflictMode: DataConflictMode;
  rowErrorPolicy: DataRowErrorPolicy;
  upsertFields: string[];
}

export interface TransferWriteResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ index: number; category: string; message: string; sourceId?: string }>;
}

export async function writeTransferBatch(
  client: MongoClient,
  request: TransferWriteRequest,
): Promise<TransferWriteResult> {
  if (request.documentsEjson.length > TRANSFER_MAX_BATCH_DOCUMENTS) {
    throw appError('Validation', `Transfer batch exceeds ${TRANSFER_MAX_BATCH_DOCUMENTS} documents.`);
  }
  const byteSize = request.documentsEjson.reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  if (byteSize > TRANSFER_MAX_BATCH_BYTES) {
    throw appError('Validation', 'Transfer batch exceeds the 8 MiB safety limit.');
  }

  const documents = request.documentsEjson.map((source, index) => {
    let value: unknown;
    try {
      value = EJSON.parse(source, { relaxed: false });
    } catch {
      throw appError('Validation', `Transferred document ${index + 1} is not valid Canonical EJSON.`);
    }
    if (!isDocument(value)) {
      throw appError('Validation', `Transferred value ${index + 1} must be a document.`);
    }
    return value;
  });

  await assertUsableUpsertKey(client, request.database, request.collection, request.upsertFields);
  const collection = client.db(request.database).collection(request.collection);
  const result: TransferWriteResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };

  if (request.conflictMode === 'insert-stop') {
    const write = await collection.insertMany(documents, { ordered: true });
    result.inserted = write.insertedCount;
    return result;
  }

  const operations = documents.map((document) => {
    if (request.conflictMode === 'insert-skip') {
      return { insertOne: { document } } as const;
    }
    const filter = buildUpsertFilter(document, request.upsertFields);
    if (request.conflictMode === 'replace-upsert') {
      return { replaceOne: { filter, replacement: document, upsert: true } } as const;
    }
    const mutable = { ...document };
    delete mutable._id;
    return {
      updateOne: {
        filter,
        update: {
          $set: mutable,
          ...(document._id !== undefined ? { $setOnInsert: { _id: document._id } } : {}),
        },
        upsert: true,
      },
    } as const;
  });

  try {
    const write = await collection.bulkWrite(operations, { ordered: false });
    result.inserted = write.insertedCount + write.upsertedCount;
    result.updated = write.modifiedCount + (request.conflictMode === 'merge-upsert' ? write.matchedCount : 0);
    return result;
  } catch (error) {
    const bulk = error as {
      result?: {
        insertedCount?: number;
        upsertedCount?: number;
        modifiedCount?: number;
        matchedCount?: number;
      };
      writeErrors?: Array<{ index?: number; code?: number; errmsg?: string }>;
    };
    result.inserted = (bulk.result?.insertedCount ?? 0) + (bulk.result?.upsertedCount ?? 0);
    result.updated = (bulk.result?.modifiedCount ?? 0) +
      (request.conflictMode === 'merge-upsert' ? bulk.result?.matchedCount ?? 0 : 0);
    for (const writeError of bulk.writeErrors ?? []) {
      const index = writeError.index ?? -1;
      const duplicate = writeError.code === 11000;
      if (duplicate && request.conflictMode === 'insert-skip') {
        result.skipped += 1;
        continue;
      }
      const safe = serializeError(new Error(writeError.errmsg ?? 'MongoDB write failed.'));
      result.errors.push({
        index,
        category: duplicate ? 'DuplicateKey' : safe.category,
        message: duplicate ? 'Duplicate key; row was not written.' : safe.message,
        ...sourceId(documents[index]),
      });
    }
    if (result.errors.length > 0 && request.rowErrorPolicy === 'stop') {
      throw appError('Validation', result.errors[0]!.message);
    }
    result.skipped += result.errors.length;
    return result;
  }
}

function buildUpsertFilter(document: Document, fields: string[]): Document {
  const filter = Object.create(null) as Document;
  for (const field of fields) {
    const value = readPath(document, field);
    if (value === undefined) {
      throw appError('Validation', `Upsert key "${field}" is missing from a source document.`);
    }
    setPath(filter, field, value);
  }
  return filter;
}

async function assertUsableUpsertKey(
  client: MongoClient,
  database: string,
  collectionName: string,
  fields: string[],
): Promise<void> {
  if (fields.length === 1 && fields[0] === '_id') return;
  const collection = client.db(database).collection(collectionName);
  const exists = await collectionExists(client, database, collectionName);
  if (!exists) {
    throw appError('Validation', 'A non-_id upsert key requires an existing matching unique index.');
  }
  const cursor = collection.listIndexes();
  try {
    for (;;) {
      const index = await cursor.next();
      if (!index) break;
      if (!index.unique) continue;
      if (sameFields(Object.keys(index.key), fields)) return;
    }
  } finally {
    await cursor.close().catch(() => undefined);
  }
  throw appError('Validation', `No unique target index exactly matches: ${fields.join(', ')}.`);
}

async function collectionExists(client: MongoClient, database: string, name: string): Promise<boolean> {
  const cursor = client.db(database).listCollections({ name }, { nameOnly: true });
  try {
    return Boolean(await cursor.next());
  } finally {
    await cursor.close().catch(() => undefined);
  }
}

function sameFields(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((field, index) => field === b[index]);
}

function readPath(document: Document, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => (
    value && typeof value === 'object' ? (value as Document)[part] : undefined
  ), document);
}

export function setPath(document: Document, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = document;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    const existing = current[part];
    if (!isDocument(existing)) current[part] = Object.create(null) as Document;
    current = current[part] as Document;
  }
  current[parts.at(-1)!] = value;
}

function sourceId(document: Document | undefined): { sourceId?: string } {
  if (!document || document._id === undefined) return {};
  try {
    return { sourceId: EJSON.stringify(document._id, undefined, 0, { relaxed: false }) };
  } catch {
    return {};
  }
}

function isDocument(value: unknown): value is Document {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
