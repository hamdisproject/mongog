import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import {
  createDatabase,
  moveDatabaseCollection,
  preflightDatabaseRename,
} from '../../src/query-runtime/database/operations.js';
import {
  getReplSetUri,
  getStandaloneUri,
  newClient,
  stopAll,
} from './helpers/mongo.js';

describe('database create and rename operations', () => {
  let standalone: MongoClient;
  let replicaSet: MongoClient;

  beforeAll(async () => {
    [standalone, replicaSet] = await Promise.all([
      getStandaloneUri().then(newClient),
      getReplSetUri().then(newClient),
    ]);
  }, 120_000);

  afterAll(async () => {
    await stopAll();
  });

  it.each([
    ['standalone', () => standalone],
    ['replica set', () => replicaSet],
  ])('creates a database and its initial collection on %s', async (topology, getClient) => {
    const database = `mongog_create_${topology.replaceAll(' ', '_')}`;
    const result = await createDatabase(getClient(), database, 'initial');
    expect(result).toEqual({ database, collection: 'initial' });
    expect(await getClient().db(database).listCollections({}, { nameOnly: true }).toArray())
      .toEqual([expect.objectContaining({ name: 'initial' })]);
  });

  it.each([
    ['standalone', () => standalone],
    ['replica set', () => replicaSet],
  ])('moves every collection, document, and normal index on %s', async (topology, getClient) => {
    const client = getClient();
    const suffix = topology.replaceAll(' ', '_');
    const source = `mongog_rename_${suffix}_source`;
    const target = `mongog_rename_${suffix}_target`;
    await client.db(source).collection('zeta').insertMany([{ sku: 'z-1' }, { sku: 'z-2' }]);
    await client.db(source).collection('alpha').insertOne({ sku: 'a-1', value: 42 });
    await client.db(source).collection('alpha').createIndex({ sku: 1 }, { name: 'sku_lookup' });

    const manifest = await preflightDatabaseRename(client, source, target);
    expect(manifest.collections).toEqual(['alpha', 'zeta']);
    for (const collection of manifest.collections) {
      await moveDatabaseCollection(client, source, target, collection);
    }

    expect(await client.db(target).collection('alpha').findOne({ sku: 'a-1' }))
      .toMatchObject({ sku: 'a-1', value: 42 });
    expect(await client.db(target).collection('zeta').countDocuments()).toBe(2);
    expect((await client.db(target).collection('alpha').indexes()).map((index) => index.name))
      .toContain('sku_lookup');
    const databaseNames = (await client.db('admin').admin().listDatabases({ nameOnly: true }))
      .databases.map((item) => item.name);
    expect(databaseNames).toContain(target);
    expect(databaseNames).not.toContain(source);
  }, 60_000);

  it('never overwrites an existing target namespace when the command races the preflight', async () => {
    const source = 'mongog_rename_collision_source';
    const target = 'mongog_rename_collision_target';
    await standalone.db(source).collection('items').insertOne({ owner: 'source' });
    await standalone.db(target).collection('items').insertOne({ owner: 'target' });

    await expect(moveDatabaseCollection(standalone, source, target, 'items')).rejects.toBeTruthy();
    expect(await standalone.db(target).collection('items').findOne({})).toMatchObject({ owner: 'target' });
    expect(await standalone.db(source).collection('items').findOne({})).toMatchObject({ owner: 'source' });
  });
});
