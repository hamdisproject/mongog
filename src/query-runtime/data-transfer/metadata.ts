import { EJSON } from 'bson';
import type { CollectionOptions, Document, IndexSpecification, MongoClient } from 'mongodb';
import type { DataMetadataSelection } from '../../shared/domain/index.js';
import { appError } from '../../shared/errors/index.js';
import type { SourceMetadata } from './copy-source.js';

export async function prepareTransferTarget(
  client: MongoClient,
  database: string,
  collectionName: string,
  metadata: SourceMetadata,
  selection: DataMetadataSelection,
): Promise<{ created: boolean; warnings: string[] }> {
  const databaseHandle = client.db(database);
  const existingCursor = databaseHandle.listCollections({ name: collectionName });
  let existing: Document | null;
  try {
    existing = await existingCursor.next();
  } finally {
    await existingCursor.close().catch(() => undefined);
  }
  const sourceInfo = metadata.collectionInfoEjson
    ? EJSON.parse(metadata.collectionInfoEjson, { relaxed: false }) as Document
    : undefined;
  const warnings: string[] = [];

  if (!existing) {
    const options = sourceInfo && (selection.collectionOptions || selection.validationRules)
      ? buildCreateOptions(sourceInfo, selection)
      : undefined;
    await databaseHandle.createCollection(collectionName, options);
    return { created: true, warnings };
  }

  if (selection.collectionOptions && sourceInfo) {
    const mismatches = immutableOptionMismatches(sourceInfo.options as Document | undefined, existing.options as Document | undefined);
    if (mismatches.length > 0) {
      warnings.push(`Collection options not copied (${mismatches.join(', ')} differ on the target).`);
    }
  }

  if (selection.validationRules && sourceInfo?.options && selection.replaceTargetValidator) {
    const options = sourceInfo.options as Document;
    await databaseHandle.command({
      collMod: collectionName,
      validator: options.validator ?? {},
      validationLevel: options.validationLevel ?? 'strict',
      validationAction: options.validationAction ?? 'error',
    });
  } else if (selection.validationRules && sourceInfo?.options && !selection.replaceTargetValidator) {
    const sourceValidator = (sourceInfo.options as Document).validator;
    const targetValidator = (existing.options as Document | undefined)?.validator;
    if (sourceValidator && targetValidator && canonical(sourceValidator) !== canonical(targetValidator)) {
      warnings.push('Target validator was preserved. Enable explicit validator replacement to copy it.');
    }
  }
  return { created: false, warnings };
}

export async function finalizeTransferIndexes(
  client: MongoClient,
  database: string,
  collectionName: string,
  metadata: SourceMetadata,
  selection: DataMetadataSelection,
): Promise<{ created: number; skipped: number }> {
  if (!selection.indexes) return { created: 0, skipped: 0 };
  const collection = client.db(database).collection(collectionName);
  const targetByName = new Map<string, Document>();
  const cursor = collection.listIndexes();
  try {
    for (;;) {
      const index = await cursor.next();
      if (!index) break;
      if (index.name) targetByName.set(index.name, index);
    }
  } finally {
    await cursor.close().catch(() => undefined);
  }

  let created = 0;
  let skipped = 0;
  for (const raw of metadata.indexesEjson) {
    const source = EJSON.parse(raw, { relaxed: false }) as Document;
    if (source.name === '_id_') continue;
    const name = String(source.name ?? '');
    const target = targetByName.get(name);
    if (target && comparableIndex(target) === comparableIndex(source)) {
      skipped += 1;
      continue;
    }
    if (target && !selection.recreateConflictingIndexes) {
      throw appError('Validation', `Target index "${name}" has a different definition.`);
    }
    if (target) await collection.dropIndex(name);
    const key = source.key as IndexSpecification;
    const options = { ...source } as Document;
    delete options.v;
    delete options.key;
    delete options.ns;
    await collection.createIndex(key, options);
    created += 1;
  }
  return { created, skipped };
}

function buildCreateOptions(sourceInfo: Document, selection: DataMetadataSelection): CollectionOptions {
  const source = (sourceInfo.options ?? {}) as Document;
  const options: Document = {};
  if (selection.collectionOptions) {
    for (const key of ['capped', 'size', 'max', 'timeseries', 'expireAfterSeconds', 'clusteredIndex', 'collation']) {
      if (source[key] !== undefined) options[key] = source[key];
    }
  }
  if (selection.validationRules) {
    for (const key of ['validator', 'validationLevel', 'validationAction']) {
      if (source[key] !== undefined) options[key] = source[key];
    }
  }
  return options as CollectionOptions;
}

function immutableOptionMismatches(source: Document = {}, target: Document = {}): string[] {
  return ['capped', 'size', 'max', 'timeseries', 'clusteredIndex', 'collation']
    .filter((key) => source[key] !== undefined && canonical(source[key]) !== canonical(target[key]));
}

function comparableIndex(index: Document): string {
  const value = { ...index };
  delete value.v;
  delete value.ns;
  return canonical(value);
}

function canonical(value: unknown): string {
  return EJSON.stringify(value, undefined, 0, { relaxed: false });
}
