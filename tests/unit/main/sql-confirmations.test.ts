import { describe, expect, it } from 'vitest';
import { SqlConfirmationStore } from '../../../src/main/services/sql-confirmations.js';

const context = {
  connectionId: 'conn-1',
  database: 'shop',
  source: 'DELETE FROM items',
};

describe('SQL destructive confirmation store', () => {
  it('binds a token to the exact context and consumes it once', () => {
    const store = new SqlConfirmationStore();
    const token = store.issue(context, 1_000);
    expect(store.consume(token, { ...context, source: 'DELETE FROM users' }, 1_001)).toBe(false);
    expect(store.consume(token, context, 1_002)).toBe(false);

    const valid = store.issue(context, 2_000);
    expect(store.consume(valid, context, 2_001)).toBe(true);
    expect(store.consume(valid, context, 2_002)).toBe(false);
  });

  it('expires tokens after the configured TTL', () => {
    const store = new SqlConfirmationStore(100);
    const token = store.issue(context, 1_000);
    expect(store.consume(token, context, 1_101)).toBe(false);
    expect(store.size).toBe(0);
  });
});
