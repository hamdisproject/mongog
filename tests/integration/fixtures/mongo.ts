import { MongoClient } from 'mongodb';
import { afterAll, inject } from 'vitest';

let suiteSequence = 0;

export interface MongoIntegrationSuite {
  readonly appName: string;
  readonly databaseName: string;
  readonly standaloneUri: string;
  readonly replicaSetUri: string;
  newClient(uri?: string): Promise<MongoClient>;
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
    async newClient(uri = standaloneUri) {
      const client = new MongoClient(uri, { appName });
      await client.connect();
      clients.add(client);
      return client;
    },
  };
}
