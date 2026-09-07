import type { AppError } from '../errors/index.js';

export const PROTECTED_DATABASE_NAMES = ['admin', 'config', 'local'] as const;

export interface CreateDatabaseInput {
  connectionId: string;
  database: string;
  collection: string;
}

export interface CreateDatabaseResult {
  database: string;
  collection: string;
}

export interface StartDatabaseRenameInput {
  connectionId: string;
  database: string;
  newDatabase: string;
}

export interface DatabaseRenameStartResult {
  jobId: string;
}

export type DatabaseRenameStatus = 'queued' | 'preparing' | 'running' | 'completed' | 'failed';

export interface DatabaseRenameProgressEvent {
  jobId: string;
  connectionId: string;
  sourceDatabase: string;
  targetDatabase: string;
  status: DatabaseRenameStatus;
  collectionCount: number;
  movedCount: number;
  currentCollection?: string;
  movedCollections?: string[];
  remainingCollections?: string[];
  message?: string;
  warning?: string;
  error?: AppError;
}

const utf8 = new TextEncoder();
const databaseForbiddenCharacters = /[\s/\\."$*<>:|?\0]/u;

export function databaseNameError(value: string, options: { allowProtected?: boolean } = {}): string | null {
  if (!value || value !== value.trim()) return 'Database name cannot be empty or have leading/trailing whitespace.';
  if (utf8.encode(value).byteLength >= 64) return 'Database name must be shorter than 64 UTF-8 bytes.';
  if (databaseForbiddenCharacters.test(value)) return 'Database name contains a character MongoDB does not allow.';
  if (!options.allowProtected && PROTECTED_DATABASE_NAMES.includes(value.toLowerCase() as typeof PROTECTED_DATABASE_NAMES[number])) {
    return `Database name "${value}" is reserved by MongoDB.`;
  }
  return null;
}

export function collectionNameError(value: string): string | null {
  if (!value || value !== value.trim()) return 'Collection name cannot be empty or have leading/trailing whitespace.';
  if (value.includes('\0')) return 'Collection name cannot contain a null character.';
  if (value.includes('$')) return 'Collection name cannot contain "$".';
  if (value.startsWith('system.')) return 'Collection name uses MongoDB\'s reserved system namespace.';
  return null;
}

export function namespaceLengthError(database: string, collection: string): string | null {
  return utf8.encode(`${database}.${collection}`).byteLength > 255
    ? 'Database and collection name together must not exceed 255 UTF-8 bytes.'
    : null;
}
