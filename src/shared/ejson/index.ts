/**
 * BSON-safe serialization envelopes (plan §10, ADR-08).
 *
 * Wire format is CANONICAL Extended JSON (lossless for every BSON type).
 * The renderer parses envelopes with the same bson library for typed display
 * and can re-render either relaxed or canonical EJSON.
 */
import { EJSON } from 'bson';

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

/** Render modes for display/copy (plan §10). */
export type EjsonMode = 'relaxed' | 'canonical';

export function renderEjson(value: unknown, mode: EjsonMode, pretty = true): string {
  return EJSON.stringify(value, undefined, pretty ? 2 : 0, { relaxed: mode === 'relaxed' });
}
