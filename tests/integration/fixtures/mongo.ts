import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient, type MongoClientOptions } from 'mongodb';
import { afterAll, inject } from 'vitest';

let suiteSequence = 0;

export interface MongoIntegrationSuite {
  readonly appName: string;
  readonly databaseName: string;
  readonly standaloneUri: string;
  readonly replicaSetUri: string;
  newClient(uri?: string, options?: MongoClientOptions): Promise<MongoClient>;
}

const FAIL_POINT_LOCK_TIMEOUT_MS = 120_000;

/**
 * `failCommand` is ONE global fail point per mongod, and integration files run
 * in parallel workers: arming or switching it off in one file silently changes
 * another file's armed fail point. Wrap every fail-point section (arm, use,
 * consume or switch off) in this cross-worker lock for the target server.
 */
export async function withFailPointLock<T>(uri: string, run: () => Promise<T>): Promise<T> {
  const host = new URL(uri).host.split(',')[0]!.replace(/[^A-Za-z0-9]/gu, '_');
  const lock = join(tmpdir(), `mongog-failpoint-${host}.lock`);
  const deadline = Date.now() + FAIL_POINT_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await run();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

function databaseUri(rootUri: string, databaseName: string): string {
  const url = new URL(rootUri);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function safeDatabaseName(scope: string): string {
  const slug = scope.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '');
  return `mongog_${slug}_${process.pid}_${++suiteSequence}`;
}

export function useMongoIntegrationSuite(scope: string): MongoIntegrationSuite {
  const roots = inject('mongoUris');
  const databaseName = safeDatabaseName(scope);
  const appName = `mongog-tests-${databaseName}`;
  const standaloneUri = databaseUri(roots.standalone, databaseName);
  const replicaSetUri = databaseUri(roots.replicaSet, databaseName);
  const clients = new Set<MongoClient>();

  afterAll(async () => {
    await Promise.all([...clients].map((client) => client.close(true).catch(() => undefined)));
    clients.clear();

    await Promise.all([standaloneUri, replicaSetUri].map(async (uri) => {
      const cleanup = new MongoClient(uri, { appName: 'mongog-tests-cleanup' });
      try {
        await cleanup.connect();
        const databases = await cleanup.db('admin').admin().listDatabases({ nameOnly: true });
        await Promise.all(databases.databases
          .map((database) => database.name)
          .filter((name) => name === databaseName || name.startsWith(`${databaseName}_`))
          .map((name) => cleanup.db(name).dropDatabase()));
      } finally {
        await cleanup.close(true);
      }
    }));
  });

  return {
    appName,
    databaseName,
    standaloneUri,
    replicaSetUri,
    async newClient(uri = standaloneUri, options = {}) {
      const client = new MongoClient(uri, { ...options, appName });
      await client.connect();
      clients.add(client);
      return client;
    },
  };
}
