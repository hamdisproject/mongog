import { create } from 'zustand';

interface FieldInfo {
  path: string;
  types: Array<{ bsonType: string; proportion: number }>;
  presence: number;
}

interface SchemaEntry {
  fields: FieldInfo[];
  sampledCount: number;
  sampleSize: number;
  takenAt: number;
}

const TTL_MS = 5 * 60 * 1000;

interface SchemaCacheState {
  cache: Record<string, SchemaEntry>;
  loading: Record<string, boolean>;
  getSchema: (connectionId: string, database: string, collection: string) => SchemaEntry | null;
  loadSchema: (connectionId: string, database: string, collection: string) => Promise<SchemaEntry>;
  invalidate: (connectionId: string, database: string, collection: string) => void;
}

function cacheKey(connId: string, db: string, col: string): string {
  return `${connId}:${db}:${col}`;
}

export const useSchemaCache = create<SchemaCacheState>()((set, get) => ({
  cache: {},
  loading: {},

  getSchema: (connectionId, database, collection) => {
    const key = cacheKey(connectionId, database, collection);
    const entry = get().cache[key];
    if (!entry) return null;
    if (Date.now() - entry.takenAt > TTL_MS) {
      get().invalidate(connectionId, database, collection);
      return null;
    }
    return entry;
  },

  loadSchema: async (connectionId, database, collection) => {
    const key = cacheKey(connectionId, database, collection);
    const existing = get().getSchema(connectionId, database, collection);
    if (existing) return existing;

    set((s) => ({ loading: { ...s.loading, [key]: true } }));

    try {
      const result = await window.mongog.query.sampleSchema(connectionId, database, collection);
      const entry: SchemaEntry = { ...result, takenAt: Date.now() };
      set((s) => ({
        cache: { ...s.cache, [key]: entry },
        loading: { ...s.loading, [key]: false },
      }));
      return entry;
    } catch {
      set((s) => ({ loading: { ...s.loading, [key]: false } }));
      throw new Error('Failed to load schema');
    }
  },

  invalidate: (connectionId, database, collection) => {
    const key = cacheKey(connectionId, database, collection);
    set((s) => {
      const c = { ...s.cache };
      delete c[key];
      return { cache: c };
    });
  },
}));
