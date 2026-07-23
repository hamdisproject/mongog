/**
 * Shared real-mongod fixtures (ADR-13): mongodb-memory-server downloads and
 * runs REAL mongod binaries (not an emulation), so driver behavior is exact.
 */
import { MongoMemoryServer, MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

let standalone: MongoMemoryServer | null = null;
let replSet: MongoMemoryReplSet | null = null;
const clients = new Set<MongoClient>();

export async function getStandaloneUri(): Promise<string> {
  standalone ??= await MongoMemoryServer.create();
  return standalone.getUri('mongog_test');
}

export async function getReplSetUri(): Promise<string> {
  replSet ??= await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  return replSet.getUri('mongog_test_rs');
}

export async function newClient(uri: string): Promise<MongoClient> {
  const client = new MongoClient(uri, { appName: 'mongog-tests' });
  await client.connect();
  clients.add(client);
  return client;
}

export async function stopAll(): Promise<void> {
  await Promise.all([...clients].map((c) => c.close(true)));
  clients.clear();
  await standalone?.stop();
  await replSet?.stop();
  standalone = null;
  replSet = null;
}
