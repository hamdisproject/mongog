/**
 * BSON-safe serialization envelopes (plan §10, ADR-08).
 *
 * Wire format is CANONICAL Extended JSON (lossless for every BSON type).
 * The renderer parses envelopes with the same bson library for typed display
 * and can re-render either relaxed or canonical EJSON.
 */
import {
  Binary,
  BSONRegExp,
  BSONSymbol,
  Code,
  DBRef,
  Decimal128,
  Double,
  EJSON,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  UUID,
} from 'bson';

export interface EjsonEnvelope {
  /** Canonical EJSON string. */
  ejson: string;
  /** UTF-8 byte length of the original serialized value (pre-truncation). */
  byteSize: number;
  /** True when `ejson` is a truncated preview, not the full value. */
  truncated: boolean;
  /** Opaque runtime-side handle for explicitly fetching a retained full value. */
  fullValueId?: string;
}

export const DEFAULT_MAX_PREVIEW_BYTES = 256 * 1024; // 256 KB per document preview

const textEncoder = new TextEncoder();

export function byteLength(s: string): number {
  return textEncoder.encode(s).length;
}

/**
 * Serialize any BSON-ish value to a canonical EJSON envelope.
 * Oversized values are replaced by a truncated preview string; callers can
 * always re-fetch the full value through a dedicated IPC op.
 */
export function serializeToEjson(
  value: unknown,
  maxBytes: number = DEFAULT_MAX_PREVIEW_BYTES,
): EjsonEnvelope {
  return serializeToEjsonWithFull(value, maxBytes).preview;
}

/**
 * Serialize once and retain the complete envelope alongside an oversized
 * preview. CursorRegistry uses this to expose full values through an opaque
 * handle without putting large documents on the normal result event path.
 */
export function serializeToEjsonWithFull(
  value: unknown,
  maxBytes: number = DEFAULT_MAX_PREVIEW_BYTES,
): { preview: EjsonEnvelope; full?: EjsonEnvelope } {
  let ejson: string;
  try {
    ejson = EJSON.stringify(value, undefined, 2, { relaxed: false });
  } catch (err) {
    // Circular or otherwise non-serializable JS values (possible from
    // Trusted Script Mode): degrade to an inspect-style string.
    return {
      preview: {
        ejson: JSON.stringify({ $mongogOpaque: inspectFallback(value) }),
        byteSize: 0,
        truncated: false,
      },
    };
  }
  const size = byteLength(ejson);
  if (size <= maxBytes) {
    return { preview: { ejson, byteSize: size, truncated: false } };
  }
  return {
    preview: {
      ejson: ejson.slice(0, maxBytes),
      byteSize: size,
      truncated: true,
    },
    full: {
      ejson,
      byteSize: size,
      truncated: false,
    },
  };
}

function inspectFallback(value: unknown): string {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (_k, v: unknown) => {
        if (typeof v === 'bigint') return `${v}n`;
        if (typeof v === 'function') return `[Function ${(v as Function).name || 'anonymous'}]`;
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
          const bsontype = (v as { _bsontype?: string })._bsontype;
          if (bsontype) return `[BSON ${bsontype}]`;
        }
        return v;
      },
      2,
    );
  } catch {
    return String(value);
  }
}

/** Parse a canonical EJSON envelope back into typed BSON values (renderer/main). */
export function parseEjson<T = unknown>(envelope: EjsonEnvelope): T {
  return EJSON.parse(envelope.ejson, { relaxed: false }) as T;
}

/** EJSON-only render modes retained for wire-format and compatibility helpers. */
export type EjsonMode = 'relaxed' | 'canonical';

/** Global renderer display preference. IPC remains canonical EJSON in every mode. */
export type BsonDisplayMode = 'mongosh' | EjsonMode;

/**
 * Display output favours Compass-like readability. Editable output keeps
 * explicit numeric constructors so saving a document cannot silently change
 * its BSON numeric types.
 */
export type BsonRenderPurpose = 'display' | 'editable';

export function renderEjson(value: unknown, mode: EjsonMode, pretty = true): string {
  return EJSON.stringify(value, undefined, pretty ? 2 : 0, { relaxed: mode === 'relaxed' });
}

/** Render typed BSON values without changing the canonical wire representation. */
export function renderBson(
  value: unknown,
  mode: BsonDisplayMode,
  pretty = true,
  purpose: BsonRenderPurpose = 'display',
): string {
  return mode === 'mongosh'
    ? renderMongosh(value, pretty, purpose)
    : renderEjson(value, mode, pretty);
}

/**
 * Compass-like mongosh representation. This is a formatter only: it never
 * evaluates values and it preserves BSON type information at every depth.
 */
export function renderMongosh(
  value: unknown,
  pretty = true,
  purpose: BsonRenderPurpose = 'display',
): string {
  return formatMongoshValue(value, pretty, 0, purpose);
}

function formatMongoshValue(
  value: unknown,
  pretty: boolean,
  depth: number,
  purpose: BsonRenderPurpose,
): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'bigint') return `Long(${JSON.stringify(value.toString())})`;

  if (value instanceof Date) return `ISODate(${JSON.stringify(value.toISOString())})`;
  if (value instanceof ObjectId) return `ObjectId(${JSON.stringify(value.toHexString())})`;
  if (value instanceof Int32) {
    const rendered = formatNumber(value.value);
    return purpose === 'editable' ? `Int32(${rendered})` : rendered;
  }
  if (value instanceof Long && !(value instanceof Timestamp)) {
    return `Long(${JSON.stringify(value.toString())})`;
  }
  if (value instanceof Double) {
    const rendered = formatNumber(value.value);
    const editableArgument = Number.isFinite(value.value) ? rendered : JSON.stringify(rendered);
    return purpose === 'editable' ? `Double(${editableArgument})` : rendered;
  }
  if (value instanceof Decimal128) {
    const rendered = value.toString();
    return purpose === 'editable' ? `Decimal128(${JSON.stringify(rendered)})` : rendered;
  }
  if (value instanceof UUID) return `UUID(${JSON.stringify(value.toString())})`;
  if (value instanceof Binary) {
    return `BinData(${value.sub_type}, ${JSON.stringify(value.toString('base64'))})`;
  }
  if (value instanceof BSONRegExp) {
    return `BSONRegExp(${JSON.stringify(value.pattern)}, ${JSON.stringify(value.options)})`;
  }
  if (value instanceof Timestamp) return `Timestamp({ t: ${value.t}, i: ${value.i} })`;
  if (value instanceof MinKey) return 'MinKey()';
  if (value instanceof MaxKey) return 'MaxKey()';
  if (value instanceof DBRef) {
    const args = [
      JSON.stringify(value.collection),
      formatMongoshValue(value.oid, pretty, depth + 1, purpose),
    ];
    if (value.db !== undefined || Object.keys(value.fields).length > 0) {
      args.push(value.db === undefined ? 'undefined' : JSON.stringify(value.db));
    }
    if (Object.keys(value.fields).length > 0) {
      args.push(formatMongoshValue(value.fields, pretty, depth + 1, purpose));
    }
    return `DBRef(${args.join(', ')})`;
  }
  if (value instanceof Code) {
    const args = [JSON.stringify(String(value.code))];
    if (value.scope !== null) args.push(formatMongoshValue(value.scope, pretty, depth + 1, purpose));
    return `Code(${args.join(', ')})`;
  }
  if (value instanceof BSONSymbol) return `BSONSymbol(${JSON.stringify(value.value)})`;

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (!pretty) return `[${value.map((item) => formatMongoshValue(item, false, depth + 1, purpose)).join(', ')}]`;
    const inner = value
      .map((item) => `${indent(depth + 1)}${formatMongoshValue(item, true, depth + 1, purpose)}`)
      .join(',\n');
    return `[\n${inner}\n${indent(depth)}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    if (!pretty) {
      return `{ ${entries.map(([key, nested]) => `${formatKey(key)}: ${formatMongoshValue(nested, false, depth + 1, purpose)}`).join(', ')} }`;
    }
    const inner = entries
      .map(([key, nested]) => `${indent(depth + 1)}${formatKey(key)}: ${formatMongoshValue(nested, true, depth + 1, purpose)}`)
      .join(',\n');
    return `{\n${inner}\n${indent(depth)}}`;
  }

  return JSON.stringify(String(value));
}

function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return 'Infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  if (Object.is(value, -0)) return '-0';
  return String(value);
}

function formatKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(key) ? key : JSON.stringify(key);
}

function indent(depth: number): string {
  return '  '.repeat(depth);
}
