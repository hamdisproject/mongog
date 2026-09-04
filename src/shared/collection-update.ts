import { byteLength } from './ejson/index.js';

export const MAX_COLLECTION_BULK_UPDATE_BYTES = 64 * 1024 * 1024;

export const MAX_COLLECTION_BULK_DELETE_BYTES = MAX_COLLECTION_BULK_UPDATE_BYTES;

export function bulkUpdatePayloadExceedsLimit(
  payload: unknown,
  maximumBytes = MAX_COLLECTION_BULK_UPDATE_BYTES,
): boolean {
  return byteLength(JSON.stringify(payload)) > maximumBytes;
}

export function bulkDeletePayloadExceedsLimit(
  payload: unknown,
  maximumBytes = MAX_COLLECTION_BULK_DELETE_BYTES,
): boolean {
  return byteLength(JSON.stringify(payload)) > maximumBytes;
}

export function bulkFieldPathError(path: string): string | null {
  const normalized = path.trim();
  if (!normalized) return 'Field path cannot be empty.';
  if (normalized === '_id' || normalized.startsWith('_id.')) {
    return 'The immutable _id field cannot be changed.';
  }
  if (normalized.includes('\0')) return 'Field path cannot contain null characters.';
  const segments = normalized.split('.');
  if (segments.some((segment) => segment.length === 0)) {
    return 'Field path cannot contain empty segments.';
  }
  if (segments.some((segment) => segment.startsWith('$'))) {
    return 'Field path cannot contain positional or operator segments.';
  }
  return null;
}
