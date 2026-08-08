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
  ejson: { defaultMode: 'relaxed' | 'canonical' };
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
  ejson: { defaultMode: 'relaxed' },
};
