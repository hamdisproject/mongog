import { parseDocumentExpression } from '../features/script-analysis/index.js';

export interface PreparedDocumentMutation {
  /** Canonical Extended JSON ready for the typed IPC boundary. */
  documentEjson: string;
  /** Canonical Extended JSON for the document identity, when one was supplied. */
  documentIdEjson: string | null;
}

export const IMMUTABLE_DOCUMENT_ID_MESSAGE =
  'MongoDB does not allow changing the immutable _id field. Create a new document with the required _id and delete the old document instead.';

export const MISSING_DOCUMENT_ID_MESSAGE =
  'MongoDB does not allow removing the immutable _id field.';

/**
 * Parse editor input once and retain the parser's canonical Extended JSON.
 * Shell-like BSON constructors therefore cross IPC as explicit EJSON values
 * instead of being reinterpreted from the original editor text.
 */
export function prepareDocumentMutation(
  source: string,
  label = 'Document',
): PreparedDocumentMutation {
  const documentEjson = parseDocumentExpression(source, label).json;
  return {
    documentEjson,
    documentIdEjson: documentIdEjson(documentEjson),
  };
}

/** Return a user-facing error when an edit removes or changes the original identity. */
export function immutableDocumentIdError(
  originalDocumentEjson: string,
  prepared: PreparedDocumentMutation,
): string | null {
  const originalId = documentIdEjson(originalDocumentEjson);
  if (prepared.documentIdEjson === null) return MISSING_DOCUMENT_ID_MESSAGE;
  if (originalId !== prepared.documentIdEjson) return IMMUTABLE_DOCUMENT_ID_MESSAGE;
  return null;
}

function documentIdEjson(documentEjson: string): string | null {
  const value = JSON.parse(documentEjson) as unknown;
  if (!isRecord(value) || !Object.hasOwn(value, '_id')) return null;
  return JSON.stringify(value._id) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
