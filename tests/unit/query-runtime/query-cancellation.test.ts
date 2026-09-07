import { describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { ExecutionEngine } from '../../../src/query-runtime/engine/execute.js';
import { CursorRegistry } from '../../../src/query-runtime/registry/cursors.js';
import type { EngineEvent } from '../../../src/shared/domain/index.js';

describe('query execution cancellation acknowledgement', () => {
  it('does not acknowledge cancellation until the underlying script promise settles', async () => {
    let release!: (value: unknown) => void;
    const driverPromise = new Promise<unknown>((resolve) => { release = resolve; });
    const client = fakeClient(driverPromise);
    const registry = new CursorRegistry();
    const engine = new ExecutionEngine(registry);
    const events: EngineEvent[] = [];
    const handle = engine.execute({
      client,
      database: 'test',
      source: 'await db.command({ ping: 1 });',
      mode: 'query',
      timeoutMS: 0,
      registry,
      owner: { connectionId: 'conn-1', tabId: 'tab-1' },
      executionId: 'exec-1',
    }, (event) => events.push(event));

    await waitFor(() => events.some((event) => event.type === 'statement-started'));
    let acknowledged = false;
    const firstCancel = engine.cancelAndWait('exec-1').then((value) => {
      acknowledged = true;
      return value;
    });
    const repeatedCancel = engine.cancelAndWait('exec-1');

    await handle.promise;
    expect(events.at(-1)).toMatchObject({ type: 'execution-finished', status: 'cancelled' });
    expect(acknowledged).toBe(false);

    release({ ok: 1 });
    await expect(firstCancel).resolves.toBe(true);
    await expect(repeatedCancel).resolves.toBe(true);
    await handle.settled;
    await expect(engine.cancelAndWait('exec-1')).resolves.toBe(false);
    expect(events.filter((event) => event.type === 'result')).toHaveLength(0);
    expect(events.filter((event) => event.type === 'statement-error')).toHaveLength(0);
    await registry.dispose();
  });
  it.each(['race', 'all'])('tracks losing/rejected Promise.%s jobs until real operations settle', async method => {
    let release!: (value: unknown) => void;
    const slow = new Promise(resolve => { release = resolve; });
    const db = { command: ({slow: delayed}: {slow?: boolean}) => delayed ? slow : method === 'all' ? Promise.reject(new Error('failed')) : Promise.resolve(1) };
    const registry = new CursorRegistry();
    const engine = new ExecutionEngine(registry);
    const events: EngineEvent[] = [];
    const handle = engine.execute({client:{db:()=>db} as unknown as MongoClient, database:'test',
      source:`Promise.${method}([db.command({}), db.command({slow:true})]);`, mode:'query', timeoutMS:0, registry, owner:{connectionId:'test'}}, event=>events.push(event));
    let settled = false;
    void handle.settled.then(()=> { settled=true; });
    await handle.promise;
    expect(settled).toBe(false);
    expect(events.at(-1)).toMatchObject({type:'execution-finished',status:method==='all'?'failed':'completed'});
    release(2); await handle.settled;
    expect(settled).toBe(true);
    await registry.dispose();
  });

  it('cancellation at an implicit wait prevents catch and later operations from continuing', async () => {
    let release!: (value: unknown) => void;
    const slow = new Promise(resolve=> {release=resolve;});
    const commands: unknown[] = [];
    const db = { command: (value: unknown) => { commands.push(value); return slow; } };
    const registry = new CursorRegistry(); const engine = new ExecutionEngine(registry);
    const handle = engine.execute({client:{db:()=>db} as unknown as MongoClient,database:'test',
      source:'try { const value=db.command({first:1}); db.command({second:1}); } catch(error) { db.command({caught:1}); }',
      mode:'query',timeoutMS:0,registry,owner:{connectionId:'test'}},()=>{});
    handle.cancel(); await handle.promise;
    release(1); await handle.settled;
    expect(commands).toEqual([{first:1}]);
    await registry.dispose();
  });

});

function fakeClient(driverPromise: Promise<unknown>): MongoClient {
  const db = {
    command: () => driverPromise,
  };
  return {
    db: () => db,
  } as unknown as MongoClient;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for query execution state.');
}
