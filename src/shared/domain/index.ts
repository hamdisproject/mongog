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
  DbSummary,
  CollectionSummary,
  ReadPreferenceMode,
} from './connections.js';

export type {
  WorkspaceTabKind,
  WorkspaceTab,
  WorkspaceState,
  QueryHistoryEntry,
  HistoryQuery,
  ApplicationSettings,
  SavedScript,
} from './workspace.js';

export { DEFAULT_WORKSPACE, DEFAULT_SETTINGS } from './workspace.js';

export type ConnectionState =
  | { status: 'disconnected' }
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
