/**
 * Settings → Query timeout: the execution budget also becomes the CSOT
 * `timeoutMS` of the script's `db`, so a shorter client-level default (the
 * connection profile's Operation timeout) cannot fail a query the user allowed
 * to run longer — including "No limit" (0).
 *
 * Uses the replica-set mongod: `failCommand` is one global fail point per
 * server, and the standalone one is armed concurrently by other suites.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EJSON } from 'bson';
import type { MongoClient } from 'mongodb';
import { ExecutionEngine } from '../../../src/query-runtime/engine/execute.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import { useMongoIntegrationSuite, withFailPointLock } from '../fixtures/mongo.js';
import { executeAndCollect } from './helpers/execution.js';

const suite = useMongoIntegrationSuite('query-timeout');
const DATABASE = suite.databaseName;
const CLIENT_TIMEOUT_MS = 300;
const BLOCK_MS = 1_000;

describe('query timeout', () => {
  let client: MongoClient;
  let control: MongoClient;
  let registry: CursorRegistry;
  let engine: ExecutionEngine;

  beforeAll(async () => {
    const uri = await suite.replicaSetUri;
    control = await suite.newClient(uri);
    client = await suite.newClient(uri, { timeoutMS: CLIENT_TIMEOUT_MS });
    registry = new CursorRegistry();
    engine = new ExecutionEngine(registry);
    await control.db(DATABASE).collection('slow').insertOne({ value: 1 });
  });

  afterAll(async () => {
    await registry.dispose();
  });

  const blockNextFind = () => control.db('admin').command({
    configureFailPoint: 'failCommand',
    mode: { times: 1 },
    data: {
      appName: suite.appName,
      failCommands: ['find'],
      blockConnection: true,
      blockTimeMS: BLOCK_MS,
    },
  });

  it('fails at the shorter client CSOT when a script bypasses db (baseline)', async () => {
    await withFailPointLock(suite.replicaSetUri, async () => {
      await blockNextFind();
      const run = await executeAndCollect(
        engine, client, registry, DATABASE,
        `client.db(${JSON.stringify(DATABASE)}).collection("slow").findOne({});`,
        { timeoutMS: 0 },
      );
      expect(run.finished?.status).toBe('failed');
      expect(run.errors[0]?.category).toBe('NetworkTimeout');
    });
  }, 10_000);

  it.each([
    ['No limit', 0],
    ['a longer finite timeout', 5_000],
  ])('waits past the client CSOT with %s', async (_label, timeoutMS) => {
    await withFailPointLock(suite.replicaSetUri, async () => {
      await blockNextFind();
      const run = await executeAndCollect(
        engine, client, registry, DATABASE,
        'db.collection("slow").findOne({});',
        { timeoutMS },
      );
      expect(run.errors).toEqual([]);
      expect(run.finished?.status).toBe('completed');
      expect(run.finished?.durationMs).toBeGreaterThanOrEqual(BLOCK_MS - 50);
      expect(run.results).toHaveLength(1);
    });
  }, 10_000);

  it.each([
    ['insert', 'insertOne({ _id: 2, n: 2 })', { insertedCount: 1 }, [{ _id: 1, n: 1 }, { _id: 2, n: 2 }]],
    ['update', 'updateMany({}, { $inc: { n: 10 } })', { matchedCount: 1, modifiedCount: 1 }, [{ _id: 1, n: 11 }]],
    ['delete', 'deleteOne({ _id: 1 })', { deletedCount: 1 }, []],
  ] as const)('completes a blocked %s exactly once with No limit', async (command, call, counts, expected) => {
    await withFailPointLock(suite.replicaSetUri, async () => {
      const name = `blocked_${command}`;
      const collection = control.db(DATABASE).collection<{ _id: number; n: number }>(name);
      await collection.insertOne({ _id: 1, n: 1 });
      await control.db('admin').command({
        configureFailPoint: 'failCommand',
        mode: { times: 1 },
        data: { appName: suite.appName, failCommands: [command], blockConnection: true, blockTimeMS: BLOCK_MS },
      });

      const run = await executeAndCollect(
        engine, client, registry, DATABASE,
        `db.collection(${JSON.stringify(name)}).${call};`,
        { timeoutMS: 0 },
      );
      expect(run.errors).toEqual([]);
      expect(run.finished?.status).toBe('completed');
      expect(run.finished?.durationMs).toBeGreaterThanOrEqual(BLOCK_MS - 50);
      expect(run.results[0]?.result).toMatchObject({ kind: 'write', ...counts });
      await expect(collection.find({}).sort({ _id: 1 }).toArray()).resolves.toEqual(expected);
    });
  }, 10_000);

  it('applies the execution budget to use() and getSiblingDB() databases', async () => {
    const run = await executeAndCollect(
      engine, client, registry, DATABASE,
      'db.timeoutMS; db.getSiblingDB("other").timeoutMS; use("third").timeoutMS;',
      { timeoutMS: 0 },
    );
    expect(run.errors).toEqual([]);
    expect(run.results.map(({ result }) => result.kind === 'scalar' && EJSON.parse(result.value.ejson))).toEqual([0, 0, 0]);
  });

  it('explains an engine timeout in the console', async () => {
    const run = await executeAndCollect(
      engine, client, registry, DATABASE,
      'await new Promise(() => {});',
      { mode: 'trusted', timeoutMS: 100 },
    );
    expect(run.finished?.status).toBe('cancelled');
    const warnings = run.events.filter((event) => event.type === 'console' && event.entry.level === 'warn');
    expect(JSON.stringify(warnings)).toContain('Query timeout');
  });
});
