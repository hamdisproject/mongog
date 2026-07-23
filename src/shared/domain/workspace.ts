/** Workspace/tab domain model (plan §2/§F). */

export type WorkspaceTabKind = 'query' | 'collection' | 'history' | 'connection-settings';

export interface WorkspaceTab {
  id: string;
  kind: WorkspaceTabKind;
  title: string;
  connectionId: string | null;
  database?: string;
  collection?: string;
  /** query tabs */
  editorContent?: string;
  mode?: 'query' | 'trusted';
  /** connection-settings tabs */
  profileId?: string;
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

export interface SavedScript {
  id: string;
  name: string;
  folder: string | null;
  tags: string[];
  connectionId: string | null;
  database: string | null;
  content: string;
  language: 'javascript' | 'typescript';
  createdAt: number;
  updatedAt: number;
}
