/**
 * Schema sampling (plan §19, ADR §I Layer 3).
 *
 * Infers field paths + observed BSON types from a bounded $sample. Results
 * are ALWAYS labelled inferred — sampled schema is not enforced schema.
 */
import type { Db } from 'mongodb';
import { serializeToEjson } from '../../shared/ejson/index.js';
import type { SchemaFieldInfo } from '../../shared/domain/index.js';

export interface SampleOptions {
  sampleSize?: number; // default 1000, hard cap 5000
  maxTimeMS?: number; // default 10_000
  maxDepth?: number; // default 8
  maxPaths?: number; // default 2000
  signal?: AbortSignal;
}

interface FieldStats {
  count: number;
  types: Map<string, number>;
  arrayElementTypes?: Set<string>;
  example?: string;
}

export interface SampleResult {
  fields: SchemaFieldInfo[];
  sampledCount: number;
  sampleSize: number;
}

export async function sampleSchema(
  db: Db,
  collection: string,
  options: SampleOptions = {},
): Promise<SampleResult> {
  const sampleSize = Math.min(options.sampleSize ?? 1000, 5000);
  const maxDepth = options.maxDepth ?? 8;
  const maxPaths = options.maxPaths ?? 2000;

  const coll = db.collection(collection);
  const cursor = coll.aggregate(
    [{ $sample: { size: sampleSize } }],
    { maxTimeMS: options.maxTimeMS ?? 10_000 },
  );

  const stats = new Map<string, FieldStats>();
  let sampledCount = 0;

  try {
    while (await cursor.hasNext()) {
      if (options.signal?.aborted) break;
      const doc = await cursor.next();
      if (doc == null) break;
      sampledCount += 1;
      if (typeof doc === 'object' && doc !== null) {
        walkDocument(doc as Record<string, unknown>, '', 0, stats, { maxDepth, maxPaths });
      }
    }
  } finally {
    await cursor.close().catch(() => undefined);
  }

  const fields: SchemaFieldInfo[] = [...stats.entries()]
    .map(([path, s]) => {
      const total = [...s.types.values()].reduce((a, b) => a + b, 0) || 1;
      return {
        path,
        types: [...s.types.entries()]
          .map(([bsonType, n]) => ({ bsonType, proportion: n / total }))
          .sort((a, b) => b.proportion - a.proportion),
        presence: sampledCount === 0 ? 0 : s.count / sampledCount,
        ...(s.example !== undefined ? { exampleEjson: s.example } : {}),
        ...(s.arrayElementTypes && s.arrayElementTypes.size > 0
          ? { arrayElementTypes: [...s.arrayElementTypes] }
          : {}),
      } satisfies SchemaFieldInfo;
    })
    .sort((a, b) => b.presence - a.presence || a.path.localeCompare(b.path));

  return { fields, sampledCount, sampleSize };
}

function walkDocument(
  doc: Record<string, unknown>,
  prefix: string,
  depth: number,
  stats: Map<string, FieldStats>,
  limits: { maxDepth: number; maxPaths: number },
): void {
  if (depth > limits.maxDepth || stats.size >= limits.maxPaths) return;
  for (const [key, value] of Object.entries(doc)) {
    if (stats.size >= limits.maxPaths) return;
    const path = prefix ? `${prefix}.${key}` : key;
    const bsonType = detectBsonType(value);

    let entry = stats.get(path);
    if (!entry) {
      entry = { count: 0, types: new Map() };
      stats.set(path, entry);
    }
    entry.count += 1;
    entry.types.set(bsonType, (entry.types.get(bsonType) ?? 0) + 1);

    if (entry.example === undefined && isScalar(value)) {
      entry.example = serializeToEjson(value, 200).ejson;
    }

    if (bsonType === 'object' && value !== null && depth + 1 <= limits.maxDepth) {
      walkDocument(value as Record<string, unknown>, path, depth + 1, stats, limits);
    } else if (bsonType === 'array' && Array.isArray(value)) {
      entry.arrayElementTypes ??= new Set();
      for (const el of value.slice(0, 50)) {
        const elType = detectBsonType(el);
        entry.arrayElementTypes.add(elType);
        if (elType === 'object' && el !== null && depth + 1 <= limits.maxDepth) {
          walkDocument(el as Record<string, unknown>, `${path}[]`, depth + 1, stats, limits);
        }
      }
    }
  }
}

/** BSON-aware type detection: real BSON objects carry _bsontype. */
export function detectBsonType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const bsontype = (value as { _bsontype?: string })._bsontype;
  if (bsontype) return bsontype.toLowerCase();
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'bool';
    case 'number':
      return Number.isInteger(value) ? 'int32' : 'double';
    case 'bigint':
      return 'long';
    case 'object':
      return value instanceof Date ? 'date' : 'object';
    default:
      return typeof value;
  }
}

function isScalar(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  return t !== 'object' || (value as { _bsontype?: string })._bsontype !== undefined || value instanceof Date;
}
