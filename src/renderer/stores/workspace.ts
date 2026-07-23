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
  closeTab: (id: string) => void;
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

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  tabs: [],
  activeTabId: null,
  results: {},

  createTab: (kind, connectionId = null) => {
    const id = `tab-${++tabCounter}-${Date.now()}`;
    const tab: WorkspaceTab = {
      id,
      kind,
      title: kind === 'query' ? 'Untitled' : kind,
      connectionId,
      dirty: false,
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: id,
      results: { ...state.results, [id]: emptyExecution() },
    }));
    return id;
  },

  closeTab: (id) => {
    const execution = get().results[id];
    if (execution?.connectionId && typeof window !== 'undefined' && window.mongog) {
      if (
        execution.executionId &&
        (execution.status === 'starting' ||
          execution.status === 'running' ||
          execution.status === 'cancelling')
      ) {
        void window.mongog.query.cancel(execution.connectionId, execution.executionId);
      }
      void window.mongog.query.closeOwner(execution.connectionId, id);
    }

    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      let activeTabId = state.activeTabId;
      if (activeTabId === id) {
        if (tabs.length === 0) activeTabId = null;
        else if (index > 0) activeTabId = tabs[index - 1]!.id;
        else activeTabId = tabs[0]!.id;
      }
      const results = { ...state.results };
      delete results[id];
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
    tabCounter = state.tabs.length;
    const results: Record<string, TabExecutionState> = {};
    for (const tab of state.tabs) {
      results[tab.id] = emptyExecution();
    }
    const activeTabId = state.tabs.some((tab) => tab.id === state.activeTabId)
      ? state.activeTabId
      : state.tabs[0]?.id ?? null;
    set({ tabs: state.tabs, activeTabId, results });
  },
}));
