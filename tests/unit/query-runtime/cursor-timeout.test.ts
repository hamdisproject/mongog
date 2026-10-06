import { afterAll, describe, expect, it } from 'vitest';
import { MongoClient } from 'mongodb';
import { usePerPageTimeout } from '../../../src/query-runtime/registry/cursor-timeout.js';

// Cursors are only constructed here; no command is sent and nothing connects.
const timed = new MongoClient('mongodb://127.0.0.1:1', { timeoutMS: 1_000 });
const untimed = new MongoClient('mongodb://127.0.0.1:1');

afterAll(async () => {
  await Promise.all([timed.close(), untimed.close()]);
});

const modeOf = (cursor: unknown) =>
  (cursor as { cursorOptions: { timeoutMode?: string; omitMaxTimeMS?: boolean } }).cursorOptions;

describe('usePerPageTimeout', () => {
  it('switches CSOT find and aggregate cursors from lifetime to per-iteration budgets', () => {
    const collection = timed.db('app').collection('items');
    for (const cursor of [collection.find({}), collection.aggregate([])]) {
      expect(modeOf(cursor).timeoutMode).toBe('cursorLifetime');
      expect(usePerPageTimeout(cursor)).toBe(true);
      expect(modeOf(cursor)).toMatchObject({ timeoutMode: 'iteration', omitMaxTimeMS: true });
    }
  });

  it('leaves cursors without CSOT, with no limit, tailable cursors and non-driver values alone', () => {
    const tailable = timed.db('app').collection('capped').find({}, { tailable: true, awaitData: true });
    const cases = [
      untimed.db('app').collection('items').find({}),
      timed.db('app', { timeoutMS: 0 }).collection('items').find({}),
      tailable,
      { next: async () => null },
    ];
    for (const cursor of cases) expect(usePerPageTimeout(cursor)).toBe(false);
    expect(modeOf(tailable).timeoutMode).toBe('iteration');
  });
});
