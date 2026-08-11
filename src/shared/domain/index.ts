/**
 * Domain model subset required for Phase 0 spikes (full model: plan §F).
 * Only types that actually cross process boundaries in the spike build live here.
 */
import type { AppError, SourceRange } from '../errors/index.js';
import type { EjsonEnvelope } from '../ejson/index.js';

export type {
  ConnectionGroup,
  ConnectionOptions,
  ConnectionProfile,
  SecretPayload,
  ConnectionRuntimeState,
  TestConnectionResult,
  ConnectionDraft,
  ConnectionSecretAction,
  ConnectionDraftRequest,
  SaveAndConnectResult,
  DbSummary,
  CollectionSummary,
  ReadPreferenceMode,
} from './connections.js';

export type {
  WorkspaceTabKind,
  WorkspaceTab,
  WorkspaceState,
  AdminSection,
  QueryHistoryEntry,
  HistoryQuery,
  ApplicationSettings,
  TableColumnOrder,
} from './workspace.js';

export type {
  ExplainVerbosity,
  IndexDescription,
  GlobalSearchMatch,
  GlobalSearchResult,
  ChangeStreamStartResult,
  ChangeStreamPollResult,
  GridFsFileInfo,
  GridFsUploadResult,
  GridFsDialogResult,
} from './admin.js';

export type {
  DocumentCriteriaText,
  DocumentCriteriaState,
  SavedQueryPayload,
  SavedDocumentsPayload,
  SavedTabTemplate,
  SavedTabPayload,
  SavedItemPayload,
  SavedItemType,
  SavedFolder,
  SavedItem,
  SavedLibrarySnapshot,
  CreateSavedFolderInput,
  UpdateSavedFolderInput,
  CreateSavedItemInput,
  UpdateSavedItemInput,
  DeleteSavedFolderResult,
} from './saved.js';

export {
  AUDIT_CATEGORIES,
  AUDIT_STATUSES,
  AUDIT_ORIGINS,
  AUDIT_OPERATION_CLASSES,
} from './audit.js';

export {
  EXPORT_FORMATS,
  EXPORT_SCOPES,
  EXPORT_PHASES,
  EXPORT_JOB_STATUSES,
} from './exports.js';

export {
  DATA_JOB_KINDS,
  DATA_CONFLICT_MODES,
  DATA_ROW_ERROR_POLICIES,
  DATA_COLUMN_TYPES,
  DATA_EMPTY_CELL_POLICIES,
  DATA_JOB_STATUSES,
  DATA_JOB_PHASES,
} from './data-transfer.js';

export type {
  DataJobKind,
  DataConflictMode,
  DataRowErrorPolicy,
  FileColumnType,
  DataEmptyCellPolicy,
  DataJobStatus,
  DataJobPhase,
  DataMetadataSelection,
  FileColumnMapping,
  DataFileDescriptor,
  DataFilePreview,
  FileImportDataset,
  StartFileImportInput,
  ConnectionCopyDataset,
  StartConnectionCopyInput,
  CollectionTransferPreviewInput,
  CollectionTransferPreview,
  DataJobStartResult,
  DataDatasetSummary,
  DataJobSummary,
  DataJobProgressEvent,
} from './data-transfer.js';

export type {
  ExportFormat,
  ExportScope,
  ExportPhase,
  ExportJobStatus,
  ExportProgressEvent,
  ExportStartResult,
  CollectionExportInput,
  QueryExportValue,
  QueryResultExportInput,
} from './exports.js';

export type {
  AuditCategory,
  AuditStatus,
  AuditOrigin,
  AuditOperationClass,
  AuditLogEntry,
  AuditFilter,
  AuditListPage,
  AuditSummary,
  AuditBucket,
  AuditChangedEvent,
} from './audit.js';

export { MAX_SAVED_FOLDER_DEPTH } from './saved.js';

export {
  DEFAULT_WORKSPACE,
  DEFAULT_SETTINGS,
  CONNECTION_IDLE_TIMEOUT_VALUES,
  DEFAULT_CONNECTION_IDLE_TIMEOUT_MS,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WORKSPACE_WIDTH,
  normalizeApplicationSettings,
  normalizeSidebarWidth,
  sidebarMaximumForViewport,
  clampSidebarWidth,
  effectiveSidebarWidth,
} from './workspace.js';

export type ConnectionState =
  | { status: 'disconnected'; reason?: 'idle' | 'user'; since?: number; idleTimeoutMS?: number }
  | { status: 'connecting' }
  | { status: 'connected'; runtimePid: number; serverVersion: string; connectedAt: number }
  | { status: 'error'; error: AppError }
  | { status: 'runtime-crashed'; since: number };

export type ExecutionMode = 'query' | 'trusted';

export interface StatementInfo {
  index: number;
  range: SourceRange;
  kind: 'expression' | 'declaration' | 'control' | 'other';
}

export interface ExecuteRequest {
  connectionId: string;
  /** Renderer workspace owner used only for event routing/resource cleanup. */
  tabId?: string;
  /** Renderer-generated correlation token; never used as the engine ID. */
  runId?: string;
  database: string;
  mode: ExecutionMode;
  source: string;
  /** 0-based line/column offset of `source` inside the editor (for selections). */
  sourceOffset: { line: number; column: number };
  readOnly?: boolean;
  pageSize?: number;
  timeoutMS?: number;
}

export type QueryResult =
  | { kind: 'documents'; cursorId: string; documents: EjsonEnvelope[]; pageSize: number; hasMore: boolean }
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
      raw?: EjsonEnvelope;
    }
  | { kind: 'console'; entries: ConsoleEntry[] }
  | { kind: 'changeStream'; streamId: string; buffered: number }
  | { kind: 'opaque'; preview: string }
  | { kind: 'error'; error: AppError };

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error';
  args: EjsonEnvelope[];
  statementIndex: number;
}

export interface DocumentsPage {
  documents: EjsonEnvelope[];
  hasMore: boolean;
  pageIndex: number;
  retainedBytes: number;
}

/** Initial page returned by the Phase 3 collection browser. */
export interface CollectionDocumentsPage extends DocumentsPage {
  cursorId: string;
  pageSize: number;
}

export interface CollectionMutationResult {
  acknowledged: boolean;
  insertedId?: EjsonEnvelope;
  matchedCount?: number;
  modifiedCount?: number;
  deletedCount?: number;
}

/** Events emitted by the query engine (runtime -> main -> renderer). */
export type EngineEvent =
  | { type: 'execution-started'; executionId: string; statements: StatementInfo[] }
  | { type: 'statement-started'; index: number; range: SourceRange }
  | { type: 'result'; index: number; range: SourceRange; result: QueryResult; durationMs: number }
  | { type: 'console'; entry: ConsoleEntry }
  | { type: 'statement-error'; index: number; range: SourceRange; error: AppError; durationMs: number }
  | { type: 'statement-skipped'; index: number; range: SourceRange; reason: 'cancelled' | 'error' }
  | { type: 'execution-finished'; status: 'completed' | 'failed' | 'cancelled'; durationMs: number };

export interface SchemaFieldInfo {
  path: string;
  types: Array<{ bsonType: string; proportion: number }>;
  presence: number;
  exampleEjson?: string;
  arrayElementTypes?: string[];
}

export interface SchemaSnapshot {
  connectionId: string;
  database: string;
  collection: string;
  sampledCount: number;
  sampleSize: number;
  takenAt: number;
  ttlMs: number;
  inferred: true;
  fields: SchemaFieldInfo[];
}
