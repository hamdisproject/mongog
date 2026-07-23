/**
 * Dev-only spike target: starts an in-process mongod (real MongoDB binaries)
 * when MONGOG_SPIKE_MONGO=1. Gives the development app something real to
 * connect to without Docker. Packaged smoke must use MONGOG_SMOKE_MONGO_URI:
 * mongodb-memory-server forks process.execPath, which is the Electron binary
 * and is intentionally not a Node CLI when the production fuse is disabled.
 */
import { MongoMemoryServer, MongoMemoryReplSet } from 'mongodb-memory-server';

let standalone: MongoMemoryServer | null = null;
let replSet: MongoMemoryReplSet | null = null;

export async function startSpikeMongo(kind: 'standalone' | 'replset' = 'standalone'): Promise<string> {
  if (kind === 'replset') {
    replSet ??= await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    return replSet.getUri('spike');
  }
  standalone ??= await MongoMemoryServer.create();
  return standalone.getUri('spike');
}

export async function stopSpikeMongo(): Promise<void> {
  await standalone?.stop();
  await replSet?.stop();
  standalone = null;
  replSet = null;
}
