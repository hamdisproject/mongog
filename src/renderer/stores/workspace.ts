import { create } from 'zustand';
import type {
  ConsoleEntry,
  DocumentsPage,
  EngineEvent,
  QueryResult,
  StatementInfo,
  WorkspaceTab,
} from '../../shared/domain/index.js';
import type { AppError, SourceRange } from '../../shared/errors/index.js';
import {
  collectionDocumentsOwnerId,
  collectionQueryTemplate,
  type CollectionViewMode,
} from '../collection-workspace.js';

export type ExecutionStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'error';

export interface StatementResultState {
  index: number;
  range: SourceRange;
  durationMs: number;
  result: QueryResult;
  pageIndex: number;
  retainedBytes: number;
  cursorClosed: boolean;
}

export interface StatementErrorState {
  index: number;
  range: SourceRange;
  durationMs: number;
  error: AppError;
}

export interface SkippedStatementState {
  index: number;
  range: SourceRange;
  reason: 'cancelled' | 'error';
}

export interface TabExecutionState {
  runId: string | null;
  executionId: string | null;
  connectionId: string | null;
  status: ExecutionStatus;
  statements: StatementInfo[];
  runningStatementIndex: number | null;
  statementResults: StatementResultState[];
  statementErrors: StatementErrorState[];
  consoleEntries: ConsoleEntry[];
  skippedStatements: SkippedStatementState[];
  durationMs: number | null;
  error: string | null;
}

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  results: Record<string, TabExecutionState>;

  createTab: (kind: WorkspaceTab['kind'], connectionId?: string | null) => string;
  openQuery: (options?: { connectionId?: string | null; database?: string; title?: string; editorContent?: string }) => string;
  openCollection: (options: { connectionId: string; database: string; collection: string }) => string;
  openAdmin: (options: { connectionId: string; database: string; collection?: string; section: NonNullable<WorkspaceTab['adminSection']> }) => string;
  openChangeStream: (options: { connectionId: string; database: string; collection?: string }) => string;
  openWelcome: () => string;
  openConnections: (options?: { mode?: 'list' | 'create' | 'edit'; profileId?: string }) => string;
  openSettings: () => string;
  setCollectionView: (tabId: string, view: CollectionViewMode) => void;
  detachConnection: (connectionId: string) => void;
  renameCollectionContext: (connectionId: string, database: string, oldName: string, newName: string) => void;
  closeNamespaceTabs: (connectionId: string, database: string, collection?: string) => void;
  closeTab: (id: string) => void;
  closeTabs: (ids: string[]) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, partial: Partial<WorkspaceTab>) => void;
  prepareExecution: (tabId: string, connectionId: string, runId: string) => void;
  setExecutionId: (tabId: string, runId: string, executionId: string) => void;
  requestCancellation: (tabId: string) => void;
  failExecution: (tabId: string, runId: string, message: string) => void;
  applyEngineEvent: (
    tabId: string,
    connectionId: string,
    executionId: string,
    runId: string | undefined,
    event: EngineEvent,
  ) => void;
  updateDocumentPage: (tabId: string, cursorId: string, page: DocumentsPage) => void;
  markCursorClosed: (tabId: string, cursorId: string) => void;
  failExecutionsForConnection: (connectionId: string, message: string) => void;
  clearResults: (tabId: string) => void;
  restore: (state: { tabs: WorkspaceTab[]; activeTabId: string | null }) => void;
}

let tabCounter = 0;

function emptyExecution(): TabExecutionState {
  return {
    runId: null,
    executionId: null,
    connectionId: null,
    status: 'idle',
    statements: [],
    runningStatementIndex: null,
    statementResults: [],
    statementErrors: [],
    consoleEntries: [],
    skippedStatements: [],
    durationMs: null,
    error: null,
  };
}

function cleanupTabResources(tab: WorkspaceTab, execution: TabExecutionState | undefined): void {
  const connectionId = execution?.connectionId ?? tab.connectionId;
  if (!connectionId || typeof window === 'undefined' || !window.mongog) return;
  if (
    execution?.executionId &&
    (execution.status === 'starting' ||
      execution.status === 'running' ||
      execution.status === 'cancelling')
  ) {
    void window.mongog.query.cancel(connectionId, execution.executionId);
  }
  void window.mongog.query.closeOwner(connectionId, tab.id);
  if (tab.kind === 'collection') {
    void window.mongog.query.closeOwner(connectionId, collectionDocumentsOwnerId(tab.id));
  }
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  tabs: [],
  activeTabId: null,
  results: {},

  createTab: (kind, connectionId = null) => {
    const id = `tab-${++tabCounter}-${Date.now()}`;
    const tab: WorkspaceTab = {
      id,
      kind,
      title: kind === 'welcome'
        ? 'Welcome'
        : kind === 'query'
          ? 'Untitled'
          : kind === 'admin'
            ? 'Administration'
            : kind === 'change-stream'
              ? 'Change Stream'
            : kind === 'connection-settings'
              ? 'Connections'
              : kind === 'settings'
                ? 'Settings'
              : kind,
      connectionId,
      dirty: false,
      ...(kind === 'collection' ? { collectionViewMode: 'documents' as const } : {}),
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: id,
      results: { ...state.results, [id]: emptyExecution() },
    }));
    return id;
  },

  openQuery: (options = {}) => {
    const id = get().createTab('query', options.connectionId ?? null);
    get().updateTab(id, {
      ...(options.database ? { database: options.database } : {}),
      ...(options.title ? { title: options.title } : {}),
      ...(options.editorContent !== undefined ? { editorContent: options.editorContent } : {}),
    });
    return id;
  },

  openCollection: (options) => {
    const existing = get().tabs.find((tab) => (
      tab.kind === 'collection' &&
      tab.connectionId === options.connectionId &&
      tab.database === options.database &&
      tab.collection === options.collection
    ));
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const id = get().createTab('collection', options.connectionId);
    get().updateTab(id, {
      title: `${options.database}.${options.collection}`,
      database: options.database,
      collection: options.collection,
      collectionViewMode: 'documents',
    });
    return id;
  },

  openAdmin: (options) => {
    const existing = get().tabs.find((tab) => (
      tab.kind === 'admin' &&
      tab.connectionId === options.connectionId &&
      tab.database === options.database &&
      tab.collection === options.collection &&
      tab.adminSection === options.section
    ));
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const id = get().createTab('admin', options.connectionId);
    const scope = options.collection ? `${options.database}.${options.collection}` : options.database;
    const label = options.section === 'gridfs'
      ? 'GridFS'
      : options.section === 'search'
        ? 'Search'
        : options.section.charAt(0).toUpperCase() + options.section.slice(1);
    get().updateTab(id, {
      title: `${label} · ${scope}`,
      database: options.database,
      ...(options.collection ? { collection: options.collection } : {}),
      adminSection: options.section,
    });
    return id;
  },

  openChangeStream: (options) => {
    const existing = get().tabs.find((tab) => (
      tab.kind === 'change-stream' &&
      tab.connectionId === options.connectionId &&
      tab.database === options.database &&
      tab.collection === options.collection
    ));
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const id = get().createTab('change-stream', options.connectionId);
    const scope = options.collection ? `${options.database}.${options.collection}` : options.database;
    get().updateTab(id, {
      title: `Changes · ${scope}`,
      database: options.database,
      ...(options.collection ? { collection: options.collection } : {}),
    });
    return id;
  },

  openWelcome: () => {
    const current = get();
    const welcomeTabs = current.tabs.filter((tab) => tab.kind === 'welcome');
    const keep = welcomeTabs[0];
    if (keep) {
      const duplicateIds = new Set(welcomeTabs.slice(1).map((tab) => tab.id));
      const results = { ...current.results };
      for (const id of duplicateIds) delete results[id];
      set({
        tabs: current.tabs.filter((tab) => !duplicateIds.has(tab.id)),
        activeTabId: keep.id,
        results,
      });
      return keep.id;
    }
    return get().createTab('welcome', null);
  },

  openConnections: (options = {}) => {
    const current = get();
    const existing = current.tabs.find((tab) => tab.kind === 'connection-settings');
    const mode = options.mode ?? (options.profileId ? 'edit' : 'list');
    if (existing) {
      get().updateTab(existing.id, {
        title: 'Connections',
        connectionMode: mode,
        profileId: options.profileId,
      });
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const id = get().createTab('connection-settings', null);
    get().updateTab(id, {
      title: 'Connections',
      connectionMode: mode,
      profileId: options.profileId,
    });
    return id;
  },

  openSettings: () => {
    const existing = get().tabs.find((tab) => tab.kind === 'settings');
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    return get().createTab('settings', null);
  },

  setCollectionView: (tabId, view) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== 'collection') return tab;
        return {
          ...tab,
          collectionViewMode: view,
          ...(view === 'query' && tab.editorContent === undefined && tab.collection
            ? { editorContent: collectionQueryTemplate(tab.collection) }
            : {}),
        };
      }),
    }));
  },

  detachConnection: (connectionId) => {
    set((state) => {
      const tabs = state.tabs.map((tab) => {
        if (tab.kind === 'connection-settings' && tab.profileId === connectionId) {
          return { ...tab, profileId: undefined, connectionMode: 'list' as const };
        }
        return tab.connectionId === connectionId ? { ...tab, connectionId: null } : tab;
      });
      const results = { ...state.results };
      for (const [tabId, execution] of Object.entries(results)) {
        if (execution.connectionId === connectionId) results[tabId] = emptyExecution();
      }
      return { tabs, results };
    });
  },

  renameCollectionContext: (connectionId, database, oldName, newName) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (
          tab.connectionId !== connectionId ||
          tab.database !== database ||
          tab.collection !== oldName
        ) return tab;
        const editorContent = tab.editorContent === collectionQueryTemplate(oldName)
          ? collectionQueryTemplate(newName)
          : tab.editorContent;
        return {
          ...tab,
          collection: newName,
          ...(editorContent !== undefined ? { editorContent } : {}),
          title: tab.kind === 'collection'
            ? `${database}.${newName}`
            : tab.title.replace(`${database}.${oldName}`, `${database}.${newName}`),
        };
      }),
    }));
  },

  closeNamespaceTabs: (connectionId, database, collection) => {
    const ids = get().tabs.filter((tab) => (
      tab.connectionId === connectionId &&
      tab.database === database &&
      (collection === undefined || tab.collection === collection)
    )).map((tab) => tab.id);
    get().closeTabs(ids);
  },

  closeTab: (id) => get().closeTabs([id]),

  closeTabs: (ids) => {
    const closingIds = new Set(ids);
    if (closingIds.size === 0) return;
    const current = get();
    for (const tab of current.tabs) {
      if (closingIds.has(tab.id)) cleanupTabResources(tab, current.results[tab.id]);
    }
    set((state) => {
      const activeIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
      const tabs = state.tabs.filter((tab) => !closingIds.has(tab.id));
      let activeTabId = state.activeTabId;
      if (activeTabId && closingIds.has(activeTabId)) {
        const left = state.tabs.slice(0, activeIndex).reverse().find((tab) => !closingIds.has(tab.id));
        const right = state.tabs.slice(activeIndex + 1).find((tab) => !closingIds.has(tab.id));
        activeTabId = left?.id ?? right?.id ?? null;
      }
      const results = { ...state.results };
      for (const id of closingIds) delete results[id];
      return { tabs, activeTabId, results };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (id, partial) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...partial } : tab)),
    }));
  },

  prepareExecution: (tabId, connectionId, runId) => {
    set((state) => ({
      results: {
        ...state.results,
        [tabId]: {
          ...emptyExecution(),
          runId,
          connectionId,
          status: 'starting',
        },
      },
    }));
  },

  setExecutionId: (tabId, runId, executionId) => {
    set((state) => {
      const current = state.results[tabId];
      if (!current || current.runId !== runId) return state;
      return {
        results: {
          ...state.results,
          [tabId]: {
            ...current,
            executionId,
            status: current.status === 'starting' ? 'running' : current.status,
          },
        },
      };
    });
  },

  requestCancellation: (tabId) => {
    set((state) => {
      const current = state.results[tabId];
      if (!current) return state;
      return {
        results: {
          ...state.results,
          [tabId]: { ...current, status: 'cancelling' },
        },
      };
    });
  },

  failExecution: (tabId, runId, message) => {
    set((state) => {
      const current = state.results[tabId];
      if (!current || current.runId !== runId) return state;
      return {
        results: {
          ...state.results,
          [tabId]: { ...current, status: 'error', error: message },
        },
      };
    });
  },

  applyEngineEvent: (tabId, connectionId, executionId, runId, event) => {
    set((state) => {
      const current = state.results[tabId] ?? emptyExecution();
      if (current.runId && runId && current.runId !== runId) return state;
      if (current.executionId && current.executionId !== executionId) return state;

      let next: TabExecutionState = {
        ...current,
        runId: runId ?? current.runId,
        executionId,
        connectionId,
      };

      switch (event.type) {
        case 'execution-started':
          next = {
            ...next,
            status: 'running',
            statements: event.statements,
            error: null,
          };
          break;
        case 'statement-started':
          next = { ...next, status: 'running', runningStatementIndex: event.index };
          break;
        case 'result': {
          const statementResult: StatementResultState = {
            index: event.index,
            range: event.range,
            durationMs: event.durationMs,
            result: event.result,
            pageIndex: 0,
            retainedBytes: event.result.kind === 'documents'
              ? event.result.documents.reduce((total, envelope) => total + envelope.byteSize, 0)
              : 0,
            cursorClosed: false,
          };
          next = {
            ...next,
            statementResults: [
              ...next.statementResults.filter((item) => item.index !== event.index),
              statementResult,
            ].sort((a, b) => a.index - b.index),
          };
          break;
        }
        case 'statement-error':
          next = {
            ...next,
            statementErrors: [
              ...next.statementErrors.filter((item) => item.index !== event.index),
              {
                index: event.index,
                range: event.range,
                durationMs: event.durationMs,
                error: event.error,
              },
            ].sort((a, b) => a.index - b.index),
          };
          break;
        case 'console':
          next = { ...next, consoleEntries: [...next.consoleEntries, event.entry] };
          break;
        case 'statement-skipped':
          next = {
            ...next,
            skippedStatements: [
              ...next.skippedStatements.filter((item) => item.index !== event.index),
              { index: event.index, range: event.range, reason: event.reason },
            ].sort((a, b) => a.index - b.index),
          };
          break;
        case 'execution-finished':
          next = {
            ...next,
            status: event.status,
            durationMs: event.durationMs,
            runningStatementIndex: null,
          };
          break;
      }

      return { results: { ...state.results, [tabId]: next } };
    });
  },

  updateDocumentPage: (tabId, cursorId, page) => {
    set((state) => {
      const current = state.results[tabId];
      if (!current) return state;
      return {
        results: {
          ...state.results,
          [tabId]: {
            ...current,
            statementResults: current.statementResults.map((item) => {
              if (item.result.kind !== 'documents' || item.result.cursorId !== cursorId) return item;
              return {
                ...item,
                result: {
                  ...item.result,
                  documents: page.documents,
                  hasMore: page.hasMore,
                },
                pageIndex: page.pageIndex,
                retainedBytes: page.retainedBytes,
              };
            }),
          },
        },
      };
    });
  },

  markCursorClosed: (tabId, cursorId) => {
    set((state) => {
      const current = state.results[tabId];
      if (!current) return state;
      return {
        results: {
          ...state.results,
          [tabId]: {
            ...current,
            statementResults: current.statementResults.map((item) => (
              item.result.kind === 'documents' && item.result.cursorId === cursorId
                ? { ...item, cursorClosed: true }
                : item
            )),
          },
        },
      };
    });
  },

  failExecutionsForConnection: (connectionId, message) => {
    set((state) => {
      const results = { ...state.results };
      let changed = false;
      for (const [tabId, execution] of Object.entries(results)) {
        if (
          execution.connectionId === connectionId &&
          (execution.status === 'starting' ||
            execution.status === 'running' ||
            execution.status === 'cancelling')
        ) {
          results[tabId] = {
            ...execution,
            status: 'error',
            runningStatementIndex: null,
            error: message,
          };
          changed = true;
        }
      }
      return changed ? { results } : state;
    });
  },

  clearResults: (tabId) => {
    set((state) => ({
      results: { ...state.results, [tabId]: emptyExecution() },
    }));
  },

  restore: (state) => {
    const tabs = state.tabs.map((tab) => (
      tab.kind === 'collection' && tab.collectionViewMode === undefined
        ? { ...tab, collectionViewMode: 'documents' as const }
        : tab
    ));
    tabCounter = tabs.length;
    const results: Record<string, TabExecutionState> = {};
    for (const tab of tabs) {
      results[tab.id] = emptyExecution();
    }
    const activeTabId = tabs.some((tab) => tab.id === state.activeTabId)
      ? state.activeTabId
      : tabs[0]?.id ?? null;
    set({ tabs, activeTabId, results });
  },
}));
