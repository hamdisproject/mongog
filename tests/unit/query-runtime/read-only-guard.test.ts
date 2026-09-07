import { describe, expect, it } from 'vitest';
import { MongoClient } from 'mongodb';
import { createReadOnlyDriverGuard } from '../../../src/query-runtime/engine/read-only-guard.js';

describe('read-only driver guard', () => {
  it('blocks computed and aliased collection write methods at runtime', () => {
    const raw = new MongoClient('mongodb://127.0.0.1:27017');
    const { client } = createReadOnlyDriverGuard(raw);
    const collection = client.db('db').collection('items');
    const computed = collection['insert' + 'One' as keyof typeof collection] as unknown as (value: unknown) => unknown;
    expect(() => computed({ value: 1 })).toThrow(/Read-only connection/);
    const aliased = collection.deleteMany;
    expect(() => aliased({})).toThrow(/Read-only connection/);
  });

  it('inspects dynamic commands and aggregation pipelines', () => {
    const raw = new MongoClient('mongodb://127.0.0.1:27017');
    const { client } = createReadOnlyDriverGuard(raw);
    const db = client.db('db');
    const command = { ['inse' + 'rt']: 'items', documents: [{ value: 1 }] };
    expect(() => db.command(command)).toThrow(/command "insert"/);
    expect(() => db.runCursorCommand({ ['dele' + 'te']: 'items', deletes: [] }))
      .toThrow(/command "delete"/);
    const pipeline = [{ $match: {} }, { ['$' + 'merge']: { into: 'out' } }];
    expect(() => db.collection('items').aggregate(pipeline)).toThrow(/\$out\/\$merge/);
  });

  it('wraps clients constructed through the exposed mongodb module', () => {
    const raw = new MongoClient('mongodb://127.0.0.1:27017');
    const guarded = createReadOnlyDriverGuard(raw);
    const created = new guarded.mongodb.MongoClient('mongodb://127.0.0.1:27017');
    expect(() => created.db('db').collection('items').updateOne({}, { $set: { value: 1 } }))
      .toThrow(/Read-only connection/);
  });
});
