import type { BsonDisplayMode } from '../ejson/index.js';
import type { DocumentCriteriaState } from './saved.js';

/** Workspace/tab domain model (plan §2/§F). */

export type WorkspaceTabKind =
  | 'welcome'
  | 'query'
  | 'collection'
  | 'history'
  | 'connection-settings'
  | 'settings'
  | 'admin'
  | 'change-stream';

export type AdminSection = 'indexes' | 'explain' | 'search' | 'changes' | 'gridfs';

export interface WorkspaceTab {
  id: string;
  kind: WorkspaceTabKind;
  title: string;
  connectionId: string | null;
  database?: string;
  collection?: string;
  /** collection tabs: embedded browser/query surface */
  collectionViewMode?: 'documents' | 'query';
  /** query tabs */
  editorContent?: string;
  mode?: 'query' | 'trusted';
  /** Locally saved source; deleted saved items detach without closing the tab. */
  savedItemId?: string;
  /** Collection Documents draft/applied criteria, persisted without result data. */
  documentsState?: DocumentCriteriaState;
  /** connection-settings tabs */
  profileId?: string;
  connectionMode?: 'list' | 'create' | 'edit';
  /** Phase 5 administration workspace. */
  adminSection?: AdminSection;
  /** Pinned tabs stay in the leading tab group and survive bulk-close commands. */
  pinned?: boolean;
  /** Prevents contextual/automatic title updates from replacing a user-supplied name. */
  customTitle?: boolean;
  dirty?: boolean;
}

export interface WorkspaceState {
  version: 1;
  sidebarWidth: number;
  /** e.g. "conn:<id>", "conn:<id>/db:<name>", "conn:<id>/db:<name>/cols" */
  expandedNodeKeys: string[];
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

export const DEFAULT_WORKSPACE: WorkspaceState = {
  version: 1,
  sidebarWidth: 280,
  expandedNodeKeys: [],
  tabs: [],
  activeTabId: null,
};

export interface QueryHistoryEntry {
  id: string;
  executedAt: number;
  connectionId: string;
  database: string;
  script: string;
  selection?: string;
  durationMs: number;
  status: 'success' | 'error' | 'cancelled';
  returnedCount?: number;
  modifiedCount?: number;
  favourite: boolean;
}

export interface HistoryQuery {
  text?: string;
  connectionId?: string;
  database?: string;
  fromTs?: number;
  toTs?: number;
  favouritesOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface ApplicationSettings {
  schemaVersion: number;
  theme: 'dark' | 'light' | 'system';
  editor: { fontSize: number; tabSize: number; wordWrap: boolean; minimap: boolean };
  execution: {
    defaultTimeoutMS: number;
    pageSize: number;
    maxRetainedPages: number;
    maxPreviewBytes: number;
    cursorIdleTimeoutMS: number;
    maxRuntimes: number;
    confirmDestructive: boolean;
  };
  history: { retentionDays: number; maxEntries: number };
  audit: { retentionDays: number; maxEntries: number };
  ejson: { defaultMode: BsonDisplayMode };
  window?: { bounds?: { x: number; y: number; width: number; height: number } };
}

export const DEFAULT_SETTINGS: ApplicationSettings = {
  schemaVersion: 1,
  theme: 'dark',
  editor: { fontSize: 13, tabSize: 2, wordWrap: false, minimap: false },
  execution: {
    defaultTimeoutMS: 30_000,
    pageSize: 50,
    maxRetainedPages: 20,
    maxPreviewBytes: 256 * 1024,
    cursorIdleTimeoutMS: 10 * 60 * 1000,
    maxRuntimes: 10,
    confirmDestructive: true,
  },
  history: { retentionDays: 90, maxEntries: 10_000 },
  audit: { retentionDays: 90, maxEntries: 50_000 },
  ejson: { defaultMode: 'mongosh' },
};

/** Complete partial/legacy settings without replacing valid saved preferences. */
export function normalizeApplicationSettings(value: unknown): ApplicationSettings {
  const source = isRecord(value) ? value : {};
  const editor = isRecord(source.editor) ? source.editor : {};
  const execution = isRecord(source.execution) ? source.execution : {};
  const history = isRecord(source.history) ? source.history : {};
  const audit = isRecord(source.audit) ? source.audit : {};
  const ejson = isRecord(source.ejson) ? source.ejson : {};
  const mode = ejson.defaultMode;

  return {
    schemaVersion: positiveInteger(source.schemaVersion, DEFAULT_SETTINGS.schemaVersion),
    theme: source.theme === 'light' || source.theme === 'system' || source.theme === 'dark'
      ? source.theme
      : DEFAULT_SETTINGS.theme,
    editor: {
      fontSize: integerInRange(editor.fontSize, 8, 72, DEFAULT_SETTINGS.editor.fontSize),
      tabSize: integerInRange(editor.tabSize, 1, 16, DEFAULT_SETTINGS.editor.tabSize),
      wordWrap: booleanValue(editor.wordWrap, DEFAULT_SETTINGS.editor.wordWrap),
      minimap: booleanValue(editor.minimap, DEFAULT_SETTINGS.editor.minimap),
    },
    execution: {
      defaultTimeoutMS: integerInRange(execution.defaultTimeoutMS, 0, 600_000, DEFAULT_SETTINGS.execution.defaultTimeoutMS),
      pageSize: integerInRange(execution.pageSize, 1, 500, DEFAULT_SETTINGS.execution.pageSize),
      maxRetainedPages: integerInRange(execution.maxRetainedPages, 1, 1_000, DEFAULT_SETTINGS.execution.maxRetainedPages),
      maxPreviewBytes: positiveInteger(execution.maxPreviewBytes, DEFAULT_SETTINGS.execution.maxPreviewBytes),
      cursorIdleTimeoutMS: integerInRange(execution.cursorIdleTimeoutMS, 1_000, Number.MAX_SAFE_INTEGER, DEFAULT_SETTINGS.execution.cursorIdleTimeoutMS),
      maxRuntimes: integerInRange(execution.maxRuntimes, 1, 100, DEFAULT_SETTINGS.execution.maxRuntimes),
      confirmDestructive: booleanValue(execution.confirmDestructive, DEFAULT_SETTINGS.execution.confirmDestructive),
    },
    history: {
      retentionDays: integerInRange(history.retentionDays, 1, 36_500, DEFAULT_SETTINGS.history.retentionDays),
      maxEntries: positiveInteger(history.maxEntries, DEFAULT_SETTINGS.history.maxEntries),
    },
    audit: {
      retentionDays: integerInRange(audit.retentionDays, 1, 36_500, DEFAULT_SETTINGS.audit.retentionDays),
      maxEntries: integerInRange(audit.maxEntries, 100, 1_000_000, DEFAULT_SETTINGS.audit.maxEntries),
    },
    ejson: {
      defaultMode: mode === 'relaxed' || mode === 'canonical' || mode === 'mongosh'
        ? mode
        : DEFAULT_SETTINGS.ejson.defaultMode,
    },
    window: normalizeWindowSettings(source.window),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}

function integerInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeWindowSettings(value: unknown): ApplicationSettings['window'] {
  if (!isRecord(value) || !isRecord(value.bounds)) return undefined;
  const bounds = value.bounds;
  if (
    typeof bounds.x !== 'number' || !Number.isFinite(bounds.x) ||
    typeof bounds.y !== 'number' || !Number.isFinite(bounds.y) ||
    typeof bounds.width !== 'number' || !Number.isFinite(bounds.width) || bounds.width <= 0 ||
    typeof bounds.height !== 'number' || !Number.isFinite(bounds.height) || bounds.height <= 0
  ) return undefined;
  return { bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
}
