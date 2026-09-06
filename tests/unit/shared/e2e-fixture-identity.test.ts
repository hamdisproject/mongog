import { describe, expect, it } from 'vitest';

import { createTestDatabaseUri, e2eDatabaseName } from '../../e2e/fixtures/identity.js';

describe('E2E fixture identity', () => {
  it('creates stable, bounded names for a single test execution', () => {
    const first = e2eDatabaseName('query defaults persist', 2, 0, 0);
    const same = e2eDatabaseName('query defaults persist', 2, 0, 0);
    expect(first).toBe(same);
    expect(first).toMatch(/^mongog_e2e_w2_r0_a0_/u);
    expect(Buffer.byteLength(first)).toBeLessThanOrEqual(63);
  });

  it('separates workers, repeat-each runs, retries, and different test ids', () => {
    const names = new Set([
      e2eDatabaseName('same test', 0, 0, 0),
      e2eDatabaseName('same test', 1, 0, 0),
      e2eDatabaseName('same test', 0, 1, 0),
      e2eDatabaseName('same test', 0, 0, 1),
      e2eDatabaseName('other test', 0, 0, 0),
    ]);
    expect(names.size).toBe(5);
  });

  it('adds the isolated database without discarding URI options', () => {
    expect(createTestDatabaseUri(
      'mongodb://127.0.0.1:27017/?replicaSet=testset',
      'mongog_e2e_isolated',
    )).toBe('mongodb://127.0.0.1:27017/mongog_e2e_isolated?replicaSet=testset');
  });
});
