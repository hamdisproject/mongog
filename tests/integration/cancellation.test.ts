/**
 * S9: cooperative cancellation between statements, cancellation of an open
 * cursor on cancel, and engine timeout. (The hard-kill layer belongs to the
 * supervisor and is exercised by the S8 packaged-app spike.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { ExecutionEngine } from '../../src/query-runtime/engine/execute.js';
import { CursorRegistry } from '../../src/query-runtime/registry/cursors.js';
import type { EngineEvent } from '../../src/shared/domain/index.js';
import { getStandaloneUri, newClient, stopAll } from './helpers/mongo.js';

describe('cancellation', () => {
  let client: MongoClient;
  let registry: CursorRegistry;
  let engine: ExecutionEngine;

  beforeAll(async () => {
    const uri = await getStandaloneUri();
    client = await newClient(uri);
    registry = new CursorRegistry();
    engine = new ExecutionEngine(registry);
    await client
      .db('mongog_test')
      .collection('cancellable')
      .insertMany(Array.from({ length: 2000 }, (_, i) => ({ i })));
  });

  afterAll(async () => {
    await registry.dispose();
    await stopAll();
  });

  it('cancels between statements: remaining statements are skipped', async () => {
    const source = Array.from(
      { length: 30 },
      (_, i) => `await db.collection("cancellable").countDocuments({ i: ${i} });`,
    ).join('\n');

    const events: EngineEvent[] = [];
    let results = 0;
    const handle = engine.execute(
      {
        client,
        database: 'mongog_test',
        source,
        mode: 'query',
        timeoutMS: 0, // engine timeout disabled; testing explicit cancel
        registry,
        owner: { connectionId: 'cancel' },
      },
      (e) => {
        events.push(e);
        if (e.type === 'result') {
          results += 1;
          if (results === 3) handle.cancel();
        }
      },
    );
    await handle.promise;

    const finished = events.find((e) => e.type === 'execution-finished');
    expect(finished?.type === 'execution-finished' && finished.status).toBe('cancelled');
    const skipped = events.filter((e) => e.type === 'statement-skipped');
    expect(skipped.length).toBeGreaterThan(0);
    expect(results).toBeLessThan(30);
  });

  it('closes cursors opened by a cancelled execution', async () => {
    const events: EngineEvent[] = [];
    const handle = engine.execute(
      {
        client,
        database: 'mongog_test',
        source: `
db.collection("cancellable").find({});
await new Promise(() => {}); // never resolves -> only cancellation unwinds
`,
        mode: 'trusted', // trusted: allows arbitrary JS; no engine timeout set
        timeoutMS: 0,
        registry,
        owner: { connectionId: 'cancel' },
      },
      (e) => events.push(e),
    );
    // Wait for the cursor result, then cancel.
    await new Promise<void>((resolve) => {
      const check = () => (events.some((e) => e.type === 'result') ? resolve() : setTimeout(check, 10));
      check();
    });
    expect(registry.size).toBe(1);
    handle.cancel();
    await handle.promise;
    expect(registry.size).toBe(0);
  });

  it('engine timeout cancels a long-running execution', async () => {
    const events: EngineEvent[] = [];
    const handle = engine.execute(
      {
        client,
        database: 'mongog_test',
        source: Array.from(
          { length: 200 },
          (_, i) => `await db.collection("cancellable").countDocuments({ i: { $gte: ${i} } });`,
        ).join('\n'),
        mode: 'query',
        timeoutMS: 100,
        registry,
        owner: { connectionId: 'cancel' },
      },
      (e) => events.push(e),
    );
    await handle.promise;
    const finished = events.find((e) => e.type === 'execution-finished');
    expect(finished?.type === 'execution-finished' && finished.status).toBe('cancelled');
  });
});
