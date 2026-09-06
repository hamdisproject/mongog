import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';

interface GlobalSetupProject {
  provide(key: 'mongoUris', value: { standalone: string; replicaSet: string }): void;
}

export default async function setup(project: GlobalSetupProject): Promise<() => Promise<void>> {
  const [standalone, replicaSet] = await Promise.all([
    MongoMemoryServer.create({
      instance: { args: ['--setParameter', 'enableTestCommands=1'] },
    }),
    MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      instanceOpts: [{ args: ['--setParameter', 'enableTestCommands=1'] }],
    }),
  ]);

  project.provide('mongoUris', {
    standalone: standalone.getUri(),
    replicaSet: replicaSet.getUri(),
  });

  return async () => {
    await Promise.all([standalone.stop(), replicaSet.stop()]);
  };
}
