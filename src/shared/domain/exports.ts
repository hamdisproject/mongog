import type { EjsonEnvelope, BsonDisplayMode } from '../ejson/index.js';

export const EXPORT_FORMATS = ['xlsx', 'csv', 'txt'] as const;
export const EXPORT_SCOPES = ['current-page', 'all-matching'] as const;
export const EXPORT_PHASES = ['preparing', 'reading', 'writing', 'finalizing'] as const;
export const EXPORT_JOB_STATUSES = ['running', 'completed', 'cancelled', 'error'] as const;

export type ExportFormat = typeof EXPORT_FORMATS[number];
export type ExportScope = typeof EXPORT_SCOPES[number];
export type ExportPhase = typeof EXPORT_PHASES[number];
export type ExportJobStatus = typeof EXPORT_JOB_STATUSES[number];

export interface ExportProgressEvent {
  jobId: string;
  connectionId: string;
  status: ExportJobStatus;
  phase: ExportPhase;
  processedRows: number;
  totalRows?: number;
  filename: string;
  warningCount: number;
  message?: string;
}

export type ExportStartResult =
  | { cancelled: true }
  | { cancelled: false; jobId: string; filename: string };

export interface CollectionExportInput {
  connectionId: string;
  database: string;
  collection: string;
  cursorId?: string;
  scope: ExportScope;
  format: ExportFormat;
  filterEjson: string;
  sortEjson?: string;
  projectionEjson?: string;
  bsonMode: BsonDisplayMode;
  columnOrder?: string[];
}

export type QueryExportValue =
  | { kind: 'documents'; cursorId: string }
  | { kind: 'scalar'; value: EjsonEnvelope }
  | { kind: 'command'; value: EjsonEnvelope }
  | {
      kind: 'write';
      op: 'insert' | 'update' | 'delete' | 'bulk';
      insertedCount?: number;
      modifiedCount?: number;
      deletedCount?: number;
      upsertedCount?: number;
      matchedCount?: number;
    };

export interface QueryResultExportInput {
  connectionId: string;
  database: string;
  statementIndex: number;
  format: ExportFormat;
  bsonMode: BsonDisplayMode;
  result: QueryExportValue;
}

