import { create } from 'zustand';
import type {
  ConsoleEntry,
  DocumentsPage,
  EngineEvent,
  QueryResult,
  SavedItem,
  StatementInfo,
  WorkspaceTab,
} from '../../shared/domain/index.js';
import {
  SIDEBAR_DEFAULT_WIDTH,
  clampSidebarWidth,
  normalizeSidebarWidth,
} from '../../shared/domain/workspace.js';
import type { AppError, SourceRange } from '../../shared/errors/index.js';
import {
  collectionDocumentsOwnerId,
  collectionQueryTemplate,
  emptyDocumentCriteriaState,
  renameCollectionQueryTemplate,
  type CollectionViewMode,
} from '../collection-workspace.js';
import { useSettingsStore } from './settings.js';

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
  sidebarWidth: number;
  results: Record<string, TabExecutionState>;

  createTab: (kind: WorkspaceTab['kind'], connectionId?: string | null) => string;
  openQuery: (options?: { connectionId?: string | null; database?: string; title?: string; editorContent?: string }) => string;
  openCollection: (options: {
    connectionId: string | null;
    database: string;
    collection: string;
    viewMode?: CollectionViewMode;
  }) => string;
  openSavedItem: (item: SavedItem) => string;
  openAdmin: (options: { connectionId: string; database: string; collection?: string; section: NonNullable<WorkspaceTab['adminSection']> }) => string;
  openChangeStream: (options: { connectionId: string; database: string; collection?: string }) => string;
  openWelcome: () => string;
  openConnections: (options?: { mode?: 'list' | 'create' | 'edit'; profileId?: string }) => string;
  openSettings: () => string;
  openActivityLog: () => string;
  openDataTransfer: () => string;
  setCollectionView: (tabId: string, view: CollectionViewMode) => void;
  detachConnection: (connectionId: string) => void;
  detachSavedItems: (savedItemIds: string[]) => void;
  renameCollectionContext: (connectionId: string, database: string, oldName: string, newName: string) => void;
  closeNamespaceTabs: (connectionId: string, database: string, collection?: string) => void;
  closeTab: (id: string) => void;
  closeTabs: (ids: string[]) => void;
  reorderTab: (tabId: string, targetTabId: string, position: 'before' | 'after') => boolean;
  setTabPinned: (tabId: string, pinned: boolean) => void;
  renameTab: (tabId: string, title: string) => boolean;
  setActiveTab: (id: string) => void;
  setSidebarWidth: (width: number) => void;
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
  restore: (state: { tabs: WorkspaceTab[]; activeTabId: string | null; sidebarWidth?: number }) => void;
}

let tabCounter = 0;

const RENAMEABLE_TAB_KINDS = new Set<WorkspaceTab['kind']>([
  'query',
  'collection',
  'admin',
  'change-stream',
]);

export function isTabRenameable(tab: WorkspaceTab): boolean {
  return RENAMEABLE_TAB_KINDS.has(tab.kind);
}

export type BulkCloseScope = 'others' | 'left' | 'right' | 'all';

export function bulkClosableTabIds(
  tabs: WorkspaceTab[],
  referenceTabId: string,
  scope: BulkCloseScope,
): string[] {
  const referenceIndex = tabs.findIndex((tab) => tab.id === referenceTabId);
  if (scope === 'all') return tabs.filter((tab) => !tab.pinned).map((tab) => tab.id);
  if (referenceIndex < 0) return [];
  if (scope === 'others') {
    return tabs.filter((tab) => tab.id !== referenceTabId && !tab.pinned).map((tab) => tab.id);
  }
  const candidates = scope === 'left'
    ? tabs.slice(0, referenceIndex)
    : tabs.slice(referenceIndex + 1);
  return candidates.filter((tab) => !tab.pinned).map((tab) => tab.id);
}

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
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
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
            : kind === 'data-transfer'
              ? 'Data Transfer'
            : kind === 'connection-settings'
              ? 'Connections'
              : kind === 'settings'
                ? 'Settings'
                : kind === 'history'
                  ? 'Activity Log'
              : kind,
      connectionId,
      pinned: false,
      customTitle: false,
      dirty: false,
      ...(kind === 'collection' ? {
        collectionViewMode: 'documents' as const,
        documentsState: emptyDocumentCriteriaState(),
      } : {}),
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
    const settings = useSettingsStore.getState().settings;
    const viewMode = options.viewMode ?? settings.collection.defaultView;
    const id = get().createTab('collection', options.connectionId);
    get().updateTab(id, {
      title: `${options.database}.${options.collection}`,
      database: options.database,
      collection: options.collection,
      collectionViewMode: viewMode,
      documentsState: emptyDocumentCriteriaState(),
      ...(viewMode === 'query' ? {
        editorContent: collectionQueryTemplate(options.collection, settings.execution.pageSize),
        autoExecuteOnOpen: options.viewMode === undefined && settings.collection.autoExecuteDefaultQuery,
      } : {}),
    });
    return id;
  },

  openSavedItem: (item) => {
    const existing = get().tabs.find((tab) => tab.savedItemId === item.id);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }

    if (item.payload.type === 'query') {
      const id = get().createTab('query', item.connectionId);
      get().updateTab(id, {
        title: item.name,
        customTitle: true,
        savedItemId: item.id,
        database: item.database ?? undefined,
        editorContent: item.payload.source,
        mode: item.payload.mode,
        dirty: false,
      });
      return id;
    }

    if (item.payload.type === 'documents') {
      const id = get().createTab('collection', item.connectionId);
      get().updateTab(id, {
        title: item.name,
        customTitle: true,
        savedItemId: item.id,
        database: item.database ?? undefined,
        collection: item.collection ?? undefined,
        collectionViewMode: 'documents',
        documentsState: {
          draft: { ...item.payload.criteria },
          applied: { ...item.payload.criteria },
        },
        dirty: false,
      });
      return id;
    }

    const template = item.payload.template;
    const id = get().createTab(template.kind, item.connectionId);
    get().updateTab(id, {
      title: template.title || item.name,
      customTitle: template.customTitle,
      savedItemId: item.id,
      database: item.database ?? undefined,
      collection: item.collection ?? undefined,
      collectionViewMode: template.collectionViewMode,
      editorContent: template.editorContent,
      mode: template.mode,
      documentsState: template.documentsState
        ? structuredClone(template.documentsState)
        : template.kind === 'collection'
          ? emptyDocumentCriteriaState()
          : undefined,
      dirty: false,
    });
    if (template.pinned) get().setTabPinned(id, true);
    get().updateTab(id, { dirty: false });
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

  openActivityLog: () => {
    const current = get();
    const historyTabs = current.tabs.filter((tab) => tab.kind === 'history');
    const keep = historyTabs[0];
    if (keep) {
      const duplicateIds = new Set(historyTabs.slice(1).map((tab) => tab.id));
      const results = { ...current.results };
      for (const id of duplicateIds) delete results[id];
      set({
        tabs: current.tabs
          .filter((tab) => !duplicateIds.has(tab.id))
          .map((tab) => tab.id === keep.id
            ? { ...tab, title: 'Activity Log', customTitle: false }
            : tab),
        activeTabId: keep.id,
        results,
      });
      return keep.id;
    }
    return get().createTab('history', null);
  },

  openDataTransfer: () => {
    const current = get();
    const transferTabs = current.tabs.filter((tab) => tab.kind === 'data-transfer');
    const keep = transferTabs[0];
    if (keep) {
      const duplicateIds = new Set(transferTabs.slice(1).map((tab) => tab.id));
      const results = { ...current.results };
      for (const id of duplicateIds) delete results[id];
      set({
        tabs: current.tabs
          .filter((tab) => !duplicateIds.has(tab.id))
          .map((tab) => tab.id === keep.id
            ? { ...tab, title: 'Data Transfer', customTitle: false }
            : tab),
        activeTabId: keep.id,
        results,
      });
      return keep.id;
    }
    return get().createTab('data-transfer', null);
  },

  setCollectionView: (tabId, view) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.kind !== 'collection') return tab;
        return {
          ...tab,
          collectionViewMode: view,
          ...(tab.savedItemId && tab.collectionViewMode !== view ? { dirty: true } : {}),
          ...(view === 'query' && tab.editorContent === undefined && tab.collection
            ? {
                editorContent: collectionQueryTemplate(
                  tab.collection,
                  useSettingsStore.getState().settings.execution.pageSize,
                ),
              }
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

  detachSavedItems: (savedItemIds) => {
    const ids = new Set(savedItemIds);
    if (ids.size === 0) return;
    set((state) => ({
      tabs: state.tabs.map((tab) => (
        tab.savedItemId && ids.has(tab.savedItemId)
          ? { ...tab, savedItemId: undefined, dirty: true }
          : tab
      )),
    }));
  },

  renameCollectionContext: (connectionId, database, oldName, newName) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (
          tab.connectionId !== connectionId ||
          tab.database !== database ||
          tab.collection !== oldName
        ) return tab;
        const editorContent = renameCollectionQueryTemplate(tab.editorContent, oldName, newName);
        return {
          ...tab,
          collection: newName,
          ...(editorContent !== undefined ? { editorContent } : {}),
          title: tab.customTitle
            ? tab.title
            : tab.kind === 'collection'
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

  reorderTab: (tabId, targetTabId, position) => {
    if (tabId === targetTabId) return false;
    const current = get().tabs;
    const source = current.find((tab) => tab.id === tabId);
    const target = current.find((tab) => tab.id === targetTabId);
    if (!source || !target || !!source.pinned !== !!target.pinned) return false;

    const tabs = current.filter((tab) => tab.id !== tabId);
    const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId);
    if (targetIndex < 0) return false;
    tabs.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source);
    if (tabs.every((tab, index) => tab.id === current[index]?.id)) return false;
    set({ tabs });
    return true;
  },

  setTabPinned: (tabId, pinned) => {
    set((state) => {
      const current = state.tabs.find((tab) => tab.id === tabId);
      if (!current || !!current.pinned === pinned) return state;
      const updated = { ...current, pinned, ...(current.savedItemId ? { dirty: true } : {}) };
      const tabs = state.tabs.filter((tab) => tab.id !== tabId);
      const firstUnpinnedIndex = tabs.findIndex((tab) => !tab.pinned);
      const insertIndex = pinned
        ? (firstUnpinnedIndex < 0 ? tabs.length : firstUnpinnedIndex)
        : (firstUnpinnedIndex < 0 ? tabs.length : firstUnpinnedIndex);
      tabs.splice(insertIndex, 0, updated);
      return { tabs };
    });
  },

  renameTab: (tabId, title) => {
    const trimmed = title.trim().slice(0, 120);
    const tab = get().tabs.find((candidate) => candidate.id === tabId);
    if (!tab || !isTabRenameable(tab) || !trimmed) return false;
    if (tab.title === trimmed && tab.customTitle) return false;
    get().updateTab(tabId, { title: trimmed, customTitle: true, ...(tab.savedItemId ? { dirty: true } : {}) });
    return true;
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),

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
    const seenHistory = new Set<string>();
    const seenTransfer = new Set<string>();
    const normalizedTabs = state.tabs.filter((tab) => {
      if (tab.kind === 'history') {
        if (seenHistory.size) return false;
        seenHistory.add(tab.id);
      }
      if (tab.kind === 'data-transfer') {
        if (seenTransfer.size) return false;
        seenTransfer.add(tab.id);
      }
      return true;
    }).map((tab) => ({
      ...tab,
      ...(tab.kind === 'history' ? { title: 'Activity Log', customTitle: false } : {}),
      ...(tab.kind === 'data-transfer' ? { title: 'Data Transfer', customTitle: false } : {}),
      pinned: tab.pinned ?? false,
      customTitle: tab.customTitle ?? false,
      ...(tab.kind === 'collection' && tab.collectionViewMode === undefined
        ? { collectionViewMode: 'documents' as const }
        : {}),
      ...(tab.kind === 'collection' && tab.documentsState === undefined
        ? { documentsState: emptyDocumentCriteriaState() }
        : {}),
    }));
    const tabs = [
      ...normalizedTabs.filter((tab) => tab.pinned),
      ...normalizedTabs.filter((tab) => !tab.pinned),
    ];
    tabCounter = tabs.length;
    const results: Record<string, TabExecutionState> = {};
    for (const tab of tabs) {
      results[tab.id] = emptyExecution();
    }
    const activeTabId = tabs.some((tab) => tab.id === state.activeTabId)
      ? state.activeTabId
      : tabs[0]?.id ?? null;
    set({
      tabs,
      activeTabId,
      sidebarWidth: normalizeSidebarWidth(state.sidebarWidth),
      results,
    });
  },
}));
