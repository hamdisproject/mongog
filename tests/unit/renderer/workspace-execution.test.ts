import type { EngineEvent } from '../../../src/shared/domain/index.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bulkClosableTabIds,
  useWorkspaceStore,
} from '../../../src/renderer/stores/workspace.js';
import { useSettingsStore } from '../../../src/renderer/stores/settings.js';
import { resetWorkspaceStores, statementRange } from './helpers/workspace.js';

beforeEach(resetWorkspaceStores);

describe('workspace execution store', () => {
  it('keeps sidebar width in workspace state and normalizes legacy restore values', () => {
    expect(useWorkspaceStore.getState().sidebarWidth).toBe(260);

    useWorkspaceStore.getState().setSidebarWidth(440);
    expect(useWorkspaceStore.getState().sidebarWidth).toBe(440);

    useWorkspaceStore.getState().setSidebarWidth(999);
    expect(useWorkspaceStore.getState().sidebarWidth).toBe(520);

    useWorkspaceStore.getState().restore({ tabs: [], activeTabId: null, sidebarWidth: 340 });
    expect(useWorkspaceStore.getState().sidebarWidth).toBe(340);

    useWorkspaceStore.getState().restore({ tabs: [], activeTabId: null });
    expect(useWorkspaceStore.getState().sidebarWidth).toBe(260);
  });

  it('captures Criteria visibility per new/restored tab without changing existing tabs or filters', () => {
    const namespace = { connectionId: 'conn-1', database: 'db', collection: 'items' };
    const first = useWorkspaceStore.getState().openCollection(namespace);
    expect(useWorkspaceStore.getState().tabs[0]?.documentsCriteriaOpen).toBe(true);
    const documentsState = {
      draft: { filter: '{ active: true }', sort: '{ name: 1 }', projection: '{ name: 1 }' },
      applied: { filter: '{ active: true }', sort: '{ name: 1 }', projection: '{ name: 1 }' },
    };
    useWorkspaceStore.getState().updateTab(first, { documentsCriteriaOpen: false, documentsState });
    useWorkspaceStore.getState().setCollectionView(first, 'query');
    useWorkspaceStore.getState().setCollectionView(first, 'documents');
    expect(useWorkspaceStore.getState().tabs[0]).toMatchObject({ documentsCriteriaOpen: false, documentsState });

    useSettingsStore.setState((state) => ({ settings: {
      ...state.settings, collection: { ...state.settings.collection, criteriaOpenByDefault: false },
    } }));
    useWorkspaceStore.getState().updateTab(first, { documentsCriteriaOpen: true });
    expect(useWorkspaceStore.getState().openCollection(namespace)).toBe(first);
    const second = useWorkspaceStore.getState().openCollection({ ...namespace, disposition: 'new-tab' });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === first)?.documentsCriteriaOpen).toBe(true);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === second)?.documentsCriteriaOpen).toBe(false);

    // Restore initializes even inactive tabs before they have mounted a browser.
    const tabs = useWorkspaceStore.getState().tabs;
    useWorkspaceStore.getState().restore({ tabs, activeTabId: second });
    expect(useWorkspaceStore.getState().tabs.every((tab) => tab.documentsCriteriaOpen === false)).toBe(true);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === first)?.documentsState).toEqual(documentsState);
  });

  it('routes early engine events by run token before execute IPC resolves', () => {
    const store = useWorkspaceStore.getState();
    const tabId = store.createTab('query', 'conn-1');
    useWorkspaceStore.getState().prepareExecution(tabId, 'conn-1', 'run-1');

    const started: EngineEvent = {
      type: 'execution-started',
      executionId: 'exec-1',
      statements: [{ index: 0, range: statementRange, kind: 'expression' }],
    };
    useWorkspaceStore.getState().applyEngineEvent(
      tabId,
      'conn-1',
      'exec-1',
      'run-1',
      started,
    );

    const execution = useWorkspaceStore.getState().results[tabId]!;
    expect(execution.executionId).toBe('exec-1');
    expect(execution.status).toBe('running');
    expect(execution.statements).toHaveLength(1);
  });

  it('ignores stale events from a previous run in the same tab', () => {
    const tabId = useWorkspaceStore.getState().createTab('query', 'conn-1');
    useWorkspaceStore.getState().prepareExecution(tabId, 'conn-1', 'run-new');

    useWorkspaceStore.getState().applyEngineEvent(
      tabId,
      'conn-1',
      'exec-old',
      'run-old',
      {
        type: 'statement-error',
        index: 0,
        range: statementRange,
        durationMs: 1,
        error: { category: 'Unknown', message: 'stale' },
      },
    );

    const execution = useWorkspaceStore.getState().results[tabId]!;
    expect(execution.executionId).toBeNull();
    expect(execution.statementErrors).toHaveLength(0);
    expect(execution.status).toBe('starting');
  });

  it('stores document pages and cursor state without flattening the cursor', () => {
    const tabId = useWorkspaceStore.getState().createTab('query', 'conn-1');
    useWorkspaceStore.getState().prepareExecution(tabId, 'conn-1', 'run-1');
    useWorkspaceStore.getState().applyEngineEvent(
      tabId,
      'conn-1',
      'exec-1',
      'run-1',
      {
        type: 'result',
        index: 0,
        range: statementRange,
        durationMs: 4,
        result: {
          kind: 'documents',
          cursorId: 'cursor-1',
          documents: [{ ejson: '{"n":{"$numberInt":"1"}}', byteSize: 24, truncated: false }],
          pageSize: 1,
          hasMore: true,
        },
      },
    );

    useWorkspaceStore.getState().updateDocumentPage(tabId, 'cursor-1', {
      documents: [{ ejson: '{"n":{"$numberInt":"2"}}', byteSize: 24, truncated: false }],
      hasMore: false,
      pageIndex: 1,
      retainedBytes: 48,
    });
    useWorkspaceStore.getState().markCursorClosed(tabId, 'cursor-1');

    const item = useWorkspaceStore.getState().results[tabId]!.statementResults[0]!;
    expect(item.result.kind).toBe('documents');
    if (item.result.kind === 'documents') {
      expect(item.result.documents[0]!.ejson).toContain('"2"');
      expect(item.result.hasMore).toBe(false);
    }
    expect(item.pageIndex).toBe(1);
    expect(item.cursorClosed).toBe(true);
  });

  it('records completion status and duration', () => {
    const tabId = useWorkspaceStore.getState().createTab('query', 'conn-1');
    useWorkspaceStore.getState().prepareExecution(tabId, 'conn-1', 'run-1');
    useWorkspaceStore.getState().applyEngineEvent(
      tabId,
      'conn-1',
      'exec-1',
      'run-1',
      { type: 'execution-finished', status: 'completed', durationMs: 12.5 },
    );

    const execution = useWorkspaceStore.getState().results[tabId]!;
    expect(execution.status).toBe('completed');
    expect(execution.durationMs).toBe(12.5);
  });

  it('fails only active executions owned by a stopped connection', () => {
    const first = useWorkspaceStore.getState().createTab('query', 'conn-1');
    const second = useWorkspaceStore.getState().createTab('query', 'conn-2');
    useWorkspaceStore.getState().prepareExecution(first, 'conn-1', 'run-1');
    useWorkspaceStore.getState().prepareExecution(second, 'conn-2', 'run-2');

    useWorkspaceStore.getState().failExecutionsForConnection('conn-1', 'runtime stopped');

    expect(useWorkspaceStore.getState().results[first]).toMatchObject({
      status: 'error',
      error: 'runtime stopped',
      runningStatementIndex: null,
    });
    expect(useWorkspaceStore.getState().results[second]?.status).toBe('starting');
  });

  it('keeps the cancelled target non-error and closes all connection cursors on restart', () => {
    const target = useWorkspaceStore.getState().createTab('query', 'conn-1');
    const other = useWorkspaceStore.getState().createTab('query', 'conn-1');
    useWorkspaceStore.getState().prepareExecution(target, 'conn-1', 'run-target');
    useWorkspaceStore.getState().prepareExecution(other, 'conn-1', 'run-other');
    useWorkspaceStore.getState().applyEngineEvent(target, 'conn-1', 'exec-target', 'run-target', {
      type: 'execution-started', executionId: 'exec-target', statements: [],
    });
    useWorkspaceStore.getState().applyEngineEvent(other, 'conn-1', 'exec-other', 'run-other', {
      type: 'execution-started', executionId: 'exec-other', statements: [],
    });
    useWorkspaceStore.getState().applyEngineEvent(target, 'conn-1', 'exec-target', 'run-target', {
      type: 'result',
      index: 0,
      range: statementRange,
      durationMs: 1,
      result: {
        kind: 'documents',
        cursorId: 'cursor-target',
        documents: [{ ejson: '{"n":1}', byteSize: 7, truncated: false }],
        pageSize: 50,
        hasMore: true,
      },
    });

    useWorkspaceStore.getState().handleRuntimeRestart(
      'conn-1',
      'exec-target',
      'runtime restarted',
    );

    expect(useWorkspaceStore.getState().results[target]).toMatchObject({
      status: 'cancelled',
      error: null,
      statementResults: [{ cursorClosed: true }],
    });
    expect(useWorkspaceStore.getState().results[other]).toMatchObject({
      status: 'error',
      error: 'runtime restarted',
    });
  });
});
