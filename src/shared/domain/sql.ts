import type { SourceRange } from '../errors/index.js';

export const MAX_SQL_SOURCE_BYTES = 256 * 1024;

export type SqlStatementKind = 'select' | 'insert' | 'update' | 'delete';

export type SqlExecutionKind =
  | 'find'
  | 'aggregate'
  | 'insertOne'
  | 'insertMany'
  | 'updateMany'
  | 'deleteMany';

export interface SqlTranslation {
  kind: SqlStatementKind;
  execution: SqlExecutionKind;
  collection: string;
  database?: string;
  isWrite: boolean;
  fullCollectionTarget: boolean;
  filter: Record<string, unknown>;
  projection?: Record<string, unknown>;
  sort?: Record<string, number>;
  limit?: number;
  skip?: number;
  pipeline?: Array<Record<string, unknown>>;
  documents?: Array<Record<string, unknown>>;
  update?: Record<string, unknown>;
  mongosh: string;
  /** Trusted-process-only source; never accepted from the renderer. */
  jsSource: string;
  warnings: string[];
}

export type SqlPreview = Omit<SqlTranslation, 'jsSource'>;

export interface SqlExecuteRequest {
  connectionId: string;
  tabId?: string;
  runId?: string;
  database: string;
  source: string;
  confirmationToken?: string;
  pageSize?: number;
  timeoutMS?: number;
}

export type SqlExecuteResult =
  | { status: 'confirmation-required'; confirmationToken: string; preview: SqlPreview }
  | { status: 'started'; executionId: string };

export interface SqlTranslationFailure {
  message: string;
  hint: string;
  range?: SourceRange;
}
