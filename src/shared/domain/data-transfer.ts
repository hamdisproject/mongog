/** Shared, secret-free data-transfer contracts. File paths never cross into the renderer. */

export const DATA_JOB_KINDS = ['file-import', 'connection-copy'] as const;
export type DataJobKind = (typeof DATA_JOB_KINDS)[number];

export const DATA_CONFLICT_MODES = [
  'insert-stop',
  'insert-skip',
  'replace-upsert',
  'merge-upsert',
] as const;
export type DataConflictMode = (typeof DATA_CONFLICT_MODES)[number];

export const DATA_ROW_ERROR_POLICIES = ['stop', 'skip'] as const;
export type DataRowErrorPolicy = (typeof DATA_ROW_ERROR_POLICIES)[number];

export const DATA_COLUMN_TYPES = [
  'string',
  'boolean',
  'int32',
  'long',
  'double',
  'decimal128',
  'date',
  'objectId',
  'json-ejson',
] as const;
export type FileColumnType = (typeof DATA_COLUMN_TYPES)[number];

export const DATA_EMPTY_CELL_POLICIES = ['omit', 'null', 'empty-string'] as const;
export type DataEmptyCellPolicy = (typeof DATA_EMPTY_CELL_POLICIES)[number];

export const DATA_JOB_STATUSES = [
  'queued',
  'preparing',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export type DataJobStatus = (typeof DATA_JOB_STATUSES)[number];

export const DATA_JOB_PHASES = [
  'preflight',
  'reading',
  'writing',
  'metadata',
  'finalizing',
] as const;
export type DataJobPhase = (typeof DATA_JOB_PHASES)[number];

export interface DataMetadataSelection {
  collectionOptions: boolean;
  validationRules: boolean;
  indexes: boolean;
  /** Explicitly permits replacing a same-name, different-definition target index. */
  recreateConflictingIndexes?: boolean;
  /** Explicitly permits replacing an existing target validator. */
  replaceTargetValidator?: boolean;
}

export interface FileColumnMapping {
  sourceColumn: string;
  included: boolean;
  targetField: string;
  literalFieldName?: boolean;
  type: FileColumnType;
}

export interface DataFileDescriptor {
  /** Process-memory lookup key. It is not a path and expires automatically. */
  token: string;
  name: string;
  format: 'csv' | 'xlsx';
  size: number;
  sheets: string[];
}

export interface DataFilePreview {
  fileToken: string;
  sheet?: string;
  headers: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  suggestedMappings: FileColumnMapping[];
  delimiter?: string;
  truncated: boolean;
}

export interface FileImportDataset {
  fileToken: string;
  sheet?: string;
  delimiter?: string;
  targetDatabase: string;
  targetCollection: string;
  mappings: FileColumnMapping[];
  emptyCellPolicy: DataEmptyCellPolicy;
  conflictMode: DataConflictMode;
  rowErrorPolicy: DataRowErrorPolicy;
  upsertFields: string[];
}

export interface StartFileImportInput {
  targetConnectionId: string;
  datasets: FileImportDataset[];
}

export interface ConnectionCopyDataset {
  sourceDatabase: string;
  sourceCollection: string;
  targetDatabase: string;
  targetCollection: string;
  filterSource: string;
  conflictMode: DataConflictMode;
  rowErrorPolicy: DataRowErrorPolicy;
  upsertFields: string[];
  metadata: DataMetadataSelection;
}

export interface StartConnectionCopyInput {
  sourceConnectionId: string;
  targetConnectionId: string;
  datasets: ConnectionCopyDataset[];
}

export interface CollectionTransferPreviewInput {
  connectionId: string;
  database: string;
  collection: string;
  filterSource: string;
}

export interface CollectionTransferPreview {
  documents: string[];
  truncated: boolean;
}

export interface DataJobStartResult {
  jobId: string;
}

export interface DataDatasetSummary {
  source: string;
  target: string;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface DataJobSummary {
  jobId: string;
  kind: DataJobKind;
  status: DataJobStatus;
  startedAt: number;
  completedAt?: number;
  datasets: DataDatasetSummary[];
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface DataJobProgressEvent {
  jobId: string;
  kind: DataJobKind;
  status: DataJobStatus;
  phase: DataJobPhase;
  connectionIds: string[];
  datasetIndex: number;
  datasetCount: number;
  datasetName?: string;
  rowsRead: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  message?: string;
  summary?: DataJobSummary;
  /** Indicates that a sanitized, path-free error report is available. */
  hasErrorReport?: boolean;
}

