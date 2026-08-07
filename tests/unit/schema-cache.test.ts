import { beforeEach, describe, expect, it, vi } from 'vitest';
import { schemaCacheKey, useSchemaCache } from '../../src/renderer/stores/schema-cache.js';
import type { SchemaSnapshot } from '../../src/shared/domain/index.js';

function snapshot(overrides: Partial<SchemaSnapshot> = {}): SchemaSnapshot {
  return {
    connectionId: 'conn-1',
    database: 'app',
    collection: 'users',
    sampledCount: 10,
    sampleSize: 1000,
    takenAt: Date.now(),
    ttlMs: 300_000,
    inferred: true,
    fields: [{ path: 'name', types: [{ bsonType: 'string', proportion: 1 }], presence: 1 }],
    ...overrides,
  };
}

describe('schema cache', () => {
  const sampleSchema = vi.fn();

  beforeEach(() => {
    sampleSchema.mockReset();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { mongog: { query: { sampleSchema } } },
    });
    useSchemaCache.getState().clear();
  });

  it('deduplicates concurrent samples and reuses a fresh snapshot', async () => {
    sampleSchema.mockResolvedValue(snapshot());
    const first = useSchemaCache.getState().loadSchema('conn-1', 'app', 'users');
    const second = useSchemaCache.getState().loadSchema('conn-1', 'app', 'users');
    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({ sampledCount: 10 });
    expect(sampleSchema).toHaveBeenCalledTimes(1);

    await useSchemaCache.getState().loadSchema('conn-1', 'app', 'users');
    expect(sampleSchema).toHaveBeenCalledTimes(1);
  });

  it('expires snapshots according to the server-provided TTL', () => {
    const key = schemaCacheKey('conn-1', 'app', 'users');
    useSchemaCache.setState({
      cache: { [key]: snapshot({ takenAt: Date.now() - 1000, ttlMs: 100 }) },
    });
    expect(useSchemaCache.getState().getSchema('conn-1', 'app', 'users')).toBeNull();
    expect(useSchemaCache.getState().cache[key]).toBeUndefined();
  });

  it('does not repopulate an entry invalidated while sampling is in flight', async () => {
    let resolveSample!: (value: SchemaSnapshot) => void;
    sampleSchema.mockReturnValue(new Promise<SchemaSnapshot>((resolve) => {
      resolveSample = resolve;
    }));
    const pending = useSchemaCache.getState().loadSchema('conn-1', 'app', 'users');
    useSchemaCache.getState().invalidate('conn-1', 'app', 'users');
    resolveSample(snapshot());
    await pending;
    expect(useSchemaCache.getState().getSchema('conn-1', 'app', 'users')).toBeNull();
  });

  it('starts a fresh sample after invalidating an in-flight request', async () => {
    let resolveFirst!: (value: SchemaSnapshot) => void;
    sampleSchema
      .mockReturnValueOnce(new Promise<SchemaSnapshot>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce(snapshot({ sampledCount: 20 }));

    const stale = useSchemaCache.getState().loadSchema('conn-1', 'app', 'users');
    useSchemaCache.getState().invalidate('conn-1', 'app', 'users');
    const fresh = useSchemaCache.getState().loadSchema('conn-1', 'app', 'users');
    expect(fresh).not.toBe(stale);
    await expect(fresh).resolves.toMatchObject({ sampledCount: 20 });
    resolveFirst(snapshot({ sampledCount: 5 }));
    await stale;
    expect(useSchemaCache.getState().getSchema('conn-1', 'app', 'users'))
      .toMatchObject({ sampledCount: 20 });
    expect(sampleSchema).toHaveBeenCalledTimes(2);
  });

  it('invalidates only snapshots owned by a disconnected connection', () => {
    const firstKey = schemaCacheKey('conn-1', 'app', 'users');
    const secondKey = schemaCacheKey('conn-2', 'app', 'users');
    useSchemaCache.setState({
      cache: {
        [firstKey]: snapshot(),
        [secondKey]: snapshot({ connectionId: 'conn-2' }),
      },
    });
    useSchemaCache.getState().invalidateConnection('conn-1');
    expect(useSchemaCache.getState().cache[firstKey]).toBeUndefined();
    expect(useSchemaCache.getState().cache[secondKey]).toBeDefined();
  });
});
