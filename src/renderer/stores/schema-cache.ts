import { create } from 'zustand';
import type { SchemaSnapshot } from '../../shared/domain/index.js';

interface SchemaCacheState {
  cache: Record<string, SchemaSnapshot>;
  loading: Record<string, boolean>;
  errors: Record<string, string | undefined>;
  getSchema: (connectionId: string, database: string, collection: string) => SchemaSnapshot | null;
  loadSchema: (
    connectionId: string,
    database: string,
    collection: string,
    sampleSize?: number,
  ) => Promise<SchemaSnapshot>;
  invalidate: (connectionId: string, database: string, collection: string) => void;
  invalidateConnection: (connectionId: string) => void;
  clear: () => void;
}

interface InFlightSample {
  generation: number;
  promise: Promise<SchemaSnapshot>;
}

const inFlight = new Map<string, InFlightSample>();
const generations = new Map<string, number>();

export function schemaCacheKey(connectionId: string, database: string, collection: string): string {
  return JSON.stringify([connectionId, database, collection]);
}

function generation(key: string): number {
  return generations.get(key) ?? 0;
}

function invalidateKey(key: string): void {
  generations.set(key, generation(key) + 1);
}

function keyConnectionId(key: string): string | undefined {
  try {
    const value = JSON.parse(key) as unknown;
    return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
  } catch {
    return undefined;
  }
}

export const useSchemaCache = create<SchemaCacheState>()((set, get) => ({
  cache: {},
  loading: {},
  errors: {},

  getSchema: (connectionId, database, collection) => {
    const key = schemaCacheKey(connectionId, database, collection);
    const snapshot = get().cache[key];
    if (!snapshot) return null;
    if (Date.now() - snapshot.takenAt >= snapshot.ttlMs) {
      get().invalidate(connectionId, database, collection);
      return null;
    }
    return snapshot;
  },

  loadSchema: (connectionId, database, collection, sampleSize) => {
    const key = schemaCacheKey(connectionId, database, collection);
    const cached = get().getSchema(connectionId, database, collection);
    if (cached) return Promise.resolve(cached);

    const requestedGeneration = generation(key);
    const active = inFlight.get(key);
    if (active?.generation === requestedGeneration) return active.promise;

    set((state) => ({
      loading: { ...state.loading, [key]: true },
      errors: { ...state.errors, [key]: undefined },
    }));

    const request = window.mongog.query
      .sampleSchema(connectionId, database, collection, sampleSize)
      .then((snapshot) => {
        if (generation(key) === requestedGeneration) {
          set((state) => ({ cache: { ...state.cache, [key]: snapshot } }));
        }
        return snapshot;
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        if (generation(key) === requestedGeneration) {
          set((state) => ({ errors: { ...state.errors, [key]: message } }));
        }
        throw error;
      })
      .finally(() => {
        if (inFlight.get(key)?.promise !== request) return;
        inFlight.delete(key);
        set((state) => {
          const loading = { ...state.loading };
          delete loading[key];
          return { loading };
        });
      });

    inFlight.set(key, { generation: requestedGeneration, promise: request });
    return request;
  },

  invalidate: (connectionId, database, collection) => {
    const key = schemaCacheKey(connectionId, database, collection);
    invalidateKey(key);
    set((state) => {
      const cache = { ...state.cache };
      const errors = { ...state.errors };
      delete cache[key];
      delete errors[key];
      return { cache, errors };
    });
  },

  invalidateConnection: (connectionId) => {
    const keys = new Set([
      ...Object.keys(get().cache),
      ...Object.keys(get().loading),
      ...inFlight.keys(),
    ]);
    for (const key of keys) {
      if (keyConnectionId(key) === connectionId) invalidateKey(key);
    }
    set((state) => ({
      cache: Object.fromEntries(
        Object.entries(state.cache).filter(([, snapshot]) => snapshot.connectionId !== connectionId),
      ),
      loading: Object.fromEntries(
        Object.entries(state.loading).filter(([key]) => keyConnectionId(key) !== connectionId),
      ),
      errors: Object.fromEntries(
        Object.entries(state.errors).filter(([key]) => keyConnectionId(key) !== connectionId),
      ),
    }));
  },

  clear: () => {
    const keys = new Set([...generations.keys(), ...inFlight.keys(), ...Object.keys(get().cache)]);
    for (const key of keys) invalidateKey(key);
    set({ cache: {}, loading: {}, errors: {} });
  },
}));

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}
