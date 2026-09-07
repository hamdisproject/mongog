import type { Document, MongoClient } from 'mongodb';
import type { CreateDatabaseResult } from '../../shared/domain/index.js';
import {
  collectionNameError,
  databaseNameError,
  namespaceLengthError,
} from '../../shared/domain/namespaces.js';
import { appError } from '../../shared/errors/index.js';

export interface DatabaseRenameManifest {
  collections: string[];
}

export async function createDatabase(
  client: MongoClient,
  database: string,
  collection: string,
): Promise<CreateDatabaseResult> {
  assertDatabaseName(database);
  assertCollectionNamespace(database, collection);
  const names = await listDatabaseNames(client);
  if (names.some((name) => sameDatabaseName(name, database))) {
    throw appError('Validation', `Database "${database}" already exists.`);
  }
  await client.db(database).createCollection(collection);
  return { database, collection };
}

export async function preflightDatabaseRename(
  client: MongoClient,
  sourceDatabase: string,
  targetDatabase: string,
): Promise<DatabaseRenameManifest> {
  assertDatabaseName(sourceDatabase);
  assertDatabaseName(targetDatabase);
  if (sameDatabaseName(sourceDatabase, targetDatabase)) {
    throw appError('Validation', 'The new database name must be different.');
  }

  const hello = await client.db('admin').command({ hello: 1 }, { timeoutMS: 0 });
  if ((hello as { msg?: string }).msg === 'isdbgrid') {
    throw appError('Validation', 'Database rename is not supported for sharded MongoDB deployments.');
  }

  const databaseNames = await listDatabaseNames(client, { timeoutMS: 0 });
  if (!databaseNames.includes(sourceDatabase)) {
    throw appError('NotFound', `Source database "${sourceDatabase}" no longer exists.`);
  }
  if (databaseNames.some((name) => sameDatabaseName(name, targetDatabase))) {
    throw appError('Validation', `Target database "${targetDatabase}" already exists.`);
  }

  const cursor = client.db(sourceDatabase).listCollections({}, { nameOnly: false, timeoutMS: 0 });
  const collections: string[] = [];
  try {
    for (;;) {
      const info = await cursor.next() as Document | null;
      if (!info) break;
      const name = String(info.name ?? '');
      const type = String(info.type ?? 'collection');
      const options = (info.options ?? {}) as Document;
      if (type !== 'collection') {
        throw appError('Validation', `Database rename does not support ${type} namespace "${name}".`);
      }
      if (name.startsWith('system.')) {
        throw appError('Validation', `Database rename does not support system collection "${name}".`);
      }
      if (options.timeseries !== undefined) {
        throw appError('Validation', `Database rename does not support time-series collection "${name}".`);
      }
      if (name.startsWith('enxcol_.') || options.encryptedFields !== undefined) {
        throw appError('Validation', `Database rename does not support Queryable Encryption collection "${name}".`);
      }
      assertCollectionNamespace(targetDatabase, name);
      collections.push(name);
    }
  } finally {
    await cursor.close().catch(() => undefined);
  }
  if (collections.length === 0) {
    throw appError('Validation', `Source database "${sourceDatabase}" has no collections to move.`);
  }
  collections.sort((left, right) => left.localeCompare(right));
  return { collections };
}

export async function moveDatabaseCollection(
  client: MongoClient,
  sourceDatabase: string,
  targetDatabase: string,
  collection: string,
): Promise<void> {
  assertDatabaseName(sourceDatabase);
  assertDatabaseName(targetDatabase);
  assertCollectionNamespace(sourceDatabase, collection);
  assertCollectionNamespace(targetDatabase, collection);
  await client.db('admin').command({
    renameCollection: `${sourceDatabase}.${collection}`,
    to: `${targetDatabase}.${collection}`,
    dropTarget: false,
  }, { timeoutMS: 0 });
}

async function listDatabaseNames(
  client: MongoClient,
  options: { timeoutMS?: number } = {},
): Promise<string[]> {
  const result = await client.db('admin').command({ listDatabases: 1, nameOnly: true }, options);
  return ((result as { databases?: Array<{ name?: unknown }> }).databases ?? [])
    .map((item) => String(item.name ?? ''))
    .filter(Boolean);
}

function assertDatabaseName(value: string): void {
  const message = databaseNameError(value);
  if (message) throw appError('Validation', message);
}

function assertCollectionNamespace(database: string, collection: string): void {
  const message = collectionNameError(collection) ?? namespaceLengthError(database, collection);
  if (message) throw appError('Validation', message);
}

function sameDatabaseName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
