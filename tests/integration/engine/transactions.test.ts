import { describe, expect, it } from 'vitest';
import { ExecutionEngine } from '../../../src/query-runtime/engine/execute.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import type { EngineEvent } from '../../../src/shared/domain/index.js';
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';
import { collectEngineEvents } from './helpers/execution.js';

const suite = useMongoIntegrationSuite('engine transactions');

describe('ExecutionEngine transactions (real replica set)', () => {
  it.each([false, true])('runs transactions on a replica set (explicit await: %s)', async explicitAwait => {
    const rsUri = suite.replicaSetUri;
    const rsClient = await suite.newClient(rsUri);
    const rsRegistry = new CursorRegistry();
    const rsEngine = new ExecutionEngine(rsRegistry);
    const db = rsClient.db(suite.databaseName);
    await db.collection('accounts').deleteMany({});
    await db.collection('accounts').insertMany([
      { accountNo: 'A1', balance: 200 },
      { accountNo: 'A2', balance: 0 },
    ]);

    const events: EngineEvent[] = [];
    const handle = rsEngine.execute(
      {
        client: rsClient,
        database: suite.databaseName,
        source: `
const session = client.startSession();
try {
  await session.withTransaction(async () => {
    await db.collection("accounts").updateOne({ accountNo: "A1" }, { $inc: { balance: -100 } }, { session });
    await db.collection("accounts").updateOne({ accountNo: "A2" }, { $inc: { balance: 100 } }, { session });
  });
} finally {
  await session.endSession();
}
(await db.collection("accounts").find({}).toArray()).map(a => a.balance).join(",");
`.replace(explicitAwait ? /$^/g : /\b(await|async) /g, ""),
        mode: 'trusted',
        registry: rsRegistry,
        owner: { connectionId: 'rs' },
      },
      (e) => events.push(e),
    );
    await handle.promise;
    const c = collectEngineEvents(events);
    expect(c.finished?.status).toBe('completed');
    if (c.results[0]!.result.kind === 'scalar') {
      expect(c.results[0]!.result.value.ejson).toBe('"100,100"');
    } else {
      expect.unreachable('expected scalar result');
    }
    await rsRegistry.dispose();
    await rsClient.close(true);
  });
});
