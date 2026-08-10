import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineEvent } from '../../src/shared/domain/index.js';
import { DEFAULT_SETTINGS, SIDEBAR_DEFAULT_WIDTH } from '../../src/shared/domain/workspace.js';
import {
  bulkClosableTabIds,
  useWorkspaceStore,
} from '../../src/renderer/stores/workspace.js';
import { useSettingsStore } from '../../src/renderer/stores/settings.js';

const range = { startLine: 1, startCol: 1, endLine: 1, endCol: 10 };

describe('workspace execution store', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      tabs: [], activeTabId: null, sidebarWidth: SIDEBAR_DEFAULT_WIDTH, results: {},
    });
    useSettingsStore.setState({
      settings: structuredClone(DEFAULT_SETTINGS),
      loaded: true,
      saving: false,
      error: null,
    });
  });

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

  it('routes early engine events by run token before execute IPC resolves', () => {
    const store = useWorkspaceStore.getState();
    const tabId = store.createTab('query', 'conn-1');
    useWorkspaceStore.getState().prepareExecution(tabId, 'conn-1', 'run-1');

    const started: EngineEvent = {
      type: 'execution-started',
      executionId: 'exec-1',
      statements: [{ index: 0, range, kind: 'expression' }],
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
        range,
        durationMs: 1,
        error: { category: 'Unknown', message: 'stale' },
      },
    );

    const execution = useWorkspaceStore.getState().results[tabId]!;
    expect(execution.executionId).toBeNull();
    expect(execution.statementErrors).toHaveLength(0);
    expect(execution.status).toBe('starting');
  });

  it('stores statement warnings separately and clears them for a new run', () => {
    const tabId = useWorkspaceStore.getState().createTab('query', 'conn-1');
    useWorkspaceStore.getState().prepareExecution(tabId, 'conn-1', 'run-1');
    useWorkspaceStore.getState().applyEngineEvent(
      tabId,
      'conn-1',
      'exec-1',
      'run-1',
      {
        type: 'statement-warning',
        index: 0,
        range,
        code: 'UnawaitedPromise',
        message: 'Variable "data" contains an unresolved Promise. Add await before this expression.',
        hint: 'Execution continues.',
        fix: {
          title: 'Add await',
          range: { startLine: 1, startCol: 14, endLine: 1, endCol: 14 },
          text: 'await ',
        },
      },
    );

    const warning = useWorkspaceStore.getState().results[tabId]!.statementWarnings[0]!;
    expect(warning.code).toBe('UnawaitedPromise');
    expect(warning.fix?.text).toBe('await ');
    expect(useWorkspaceStore.getState().results[tabId]!.statementErrors).toEqual([]);

    useWorkspaceStore.getState().prepareExecution(tabId, 'conn-1', 'run-2');
    expect(useWorkspaceStore.getState().results[tabId]!.statementWarnings).toEqual([]);
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
        range,
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

  it('opens one active, closeable Welcome tab and deduplicates restored copies', () => {
    const store = useWorkspaceStore.getState();
    const first = store.openWelcome();
    const second = useWorkspaceStore.getState().openWelcome();
    expect(second).toBe(first);
    expect(useWorkspaceStore.getState().tabs.filter((tab) => tab.kind === 'welcome')).toHaveLength(1);
    expect(useWorkspaceStore.getState().activeTabId).toBe(first);

    useWorkspaceStore.getState().closeTab(first);
    expect(useWorkspaceStore.getState().tabs).toHaveLength(0);
    const reopened = useWorkspaceStore.getState().openWelcome();
    expect(reopened).not.toBe(first);
    expect(useWorkspaceStore.getState().tabs[0]?.title).toBe('Welcome');
  });

  it('reuses the singleton Connections tab and changes its selected mode', () => {
    const first = useWorkspaceStore.getState().openConnections({ mode: 'create' });
    const second = useWorkspaceStore.getState().openConnections({ mode: 'edit', profileId: 'profile-1' });
    expect(second).toBe(first);
    expect(useWorkspaceStore.getState().tabs.filter((tab) => tab.kind === 'connection-settings')).toHaveLength(1);
    expect(useWorkspaceStore.getState().tabs[0]).toMatchObject({
      title: 'Connections',
      connectionMode: 'edit',
      profileId: 'profile-1',
    });
  });

  it('reuses a singleton Settings tab', () => {
    const first = useWorkspaceStore.getState().openSettings();
    const second = useWorkspaceStore.getState().openSettings();
    expect(second).toBe(first);
    expect(useWorkspaceStore.getState().tabs.filter((tab) => tab.kind === 'settings')).toHaveLength(1);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === first)).toMatchObject({
      title: 'Settings',
      connectionId: null,
    });
    expect(useWorkspaceStore.getState().activeTabId).toBe(first);
  });

  it('reuses and restores one non-renamable Activity Log tab', () => {
    const first = useWorkspaceStore.getState().openActivityLog();
    const second = useWorkspaceStore.getState().openActivityLog();
    expect(second).toBe(first);
    expect(useWorkspaceStore.getState().renameTab(first, 'My report')).toBe(false);

    useWorkspaceStore.getState().restore({
      tabs: [
        { id: 'history-1', kind: 'history', title: 'Old history', connectionId: null },
        { id: 'history-2', kind: 'history', title: 'Duplicate', connectionId: null },
      ],
      activeTabId: 'history-2',
    });
    const tabs = useWorkspaceStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ id: 'history-1', title: 'Activity Log', customTitle: false });
    expect(useWorkspaceStore.getState().activeTabId).toBe('history-1');
  });

  it('moves pinned tabs into a stable leading group and unpins at the normal-group boundary', () => {
    const first = useWorkspaceStore.getState().openQuery({ title: 'first' });
    const second = useWorkspaceStore.getState().openQuery({ title: 'second' });
    const third = useWorkspaceStore.getState().openQuery({ title: 'third' });
    const fourth = useWorkspaceStore.getState().openQuery({ title: 'fourth' });

    useWorkspaceStore.getState().setTabPinned(second, true);
    useWorkspaceStore.getState().setTabPinned(fourth, true);
    expect(useWorkspaceStore.getState().tabs.map((tab) => tab.id)).toEqual([second, fourth, first, third]);

    useWorkspaceStore.getState().setTabPinned(second, false);
    expect(useWorkspaceStore.getState().tabs.map((tab) => tab.id)).toEqual([fourth, second, first, third]);
  });

  it('reorders tabs only inside their own pinned or normal partition', () => {
    const first = useWorkspaceStore.getState().openQuery({ title: 'first' });
    const second = useWorkspaceStore.getState().openQuery({ title: 'second' });
    const third = useWorkspaceStore.getState().openQuery({ title: 'third' });
    const fourth = useWorkspaceStore.getState().openQuery({ title: 'fourth' });
    useWorkspaceStore.getState().setTabPinned(first, true);
    useWorkspaceStore.getState().setTabPinned(second, true);

    expect(useWorkspaceStore.getState().reorderTab(second, first, 'before')).toBe(true);
    expect(useWorkspaceStore.getState().reorderTab(fourth, third, 'before')).toBe(true);
    expect(useWorkspaceStore.getState().tabs.map((tab) => tab.id)).toEqual([second, first, fourth, third]);

    expect(useWorkspaceStore.getState().reorderTab(third, first, 'before')).toBe(false);
    expect(useWorkspaceStore.getState().tabs.map((tab) => tab.id)).toEqual([second, first, fourth, third]);
  });

  it('renames work tabs but preserves special and contextual titles', () => {
    const collection = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'db', collection: 'items',
    });
    const settings = useWorkspaceStore.getState().openSettings();

    expect(useWorkspaceStore.getState().renameTab(collection, '  My inventory  ')).toBe(true);
    expect(useWorkspaceStore.getState().renameTab(settings, 'Preferences')).toBe(false);
    useWorkspaceStore.getState().renameCollectionContext('conn-1', 'db', 'items', 'products');

    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === collection)).toMatchObject({
      title: 'My inventory',
      collection: 'products',
      customTitle: true,
    });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === settings)?.title).toBe('Settings');
  });

  it('excludes pinned tabs from every bulk-close selection', () => {
    const tabs = [
      { id: 'pinned', kind: 'settings', title: 'Settings', connectionId: null, pinned: true },
      { id: 'left', kind: 'query', title: 'Left', connectionId: null },
      { id: 'current', kind: 'query', title: 'Current', connectionId: null },
      { id: 'right', kind: 'query', title: 'Right', connectionId: null },
    ] satisfies import('../../src/shared/domain/index.js').WorkspaceTab[];

    expect(bulkClosableTabIds(tabs, 'current', 'left')).toEqual(['left']);
    expect(bulkClosableTabIds(tabs, 'current', 'right')).toEqual(['right']);
    expect(bulkClosableTabIds(tabs, 'current', 'others')).toEqual(['left', 'right']);
    expect(bulkClosableTabIds(tabs, 'current', 'all')).toEqual(['left', 'current', 'right']);
  });

  it('normalizes legacy pin fields and restores pinned tabs first without changing relative order', () => {
    useWorkspaceStore.getState().restore({
      tabs: [
        { id: 'normal-a', kind: 'query', title: 'A', connectionId: null },
        { id: 'pinned-a', kind: 'query', title: 'P1', connectionId: null, pinned: true },
        { id: 'normal-b', kind: 'query', title: 'B', connectionId: null },
        { id: 'pinned-b', kind: 'settings', title: 'Settings', connectionId: null, pinned: true },
      ],
      activeTabId: 'normal-b',
    });

    expect(useWorkspaceStore.getState().tabs.map((tab) => tab.id)).toEqual([
      'pinned-a', 'pinned-b', 'normal-a', 'normal-b',
    ]);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === 'normal-a')).toMatchObject({
      pinned: false,
      customTitle: false,
    });
    expect(useWorkspaceStore.getState().activeTabId).toBe('normal-b');
  });

  it('opens contextual tools once per namespace while new queries remain independent', () => {
    const firstQuery = useWorkspaceStore.getState().openQuery({ connectionId: 'conn-1', database: 'db' });
    const secondQuery = useWorkspaceStore.getState().openQuery({ connectionId: 'conn-1', database: 'db' });
    expect(secondQuery).not.toBe(firstQuery);

    const firstCollection = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'db', collection: 'items',
    });
    const secondCollection = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'db', collection: 'items',
    });
    expect(secondCollection).toBe(firstCollection);

    const changes = useWorkspaceStore.getState().openChangeStream({
      connectionId: 'conn-1', database: 'db', collection: 'items',
    });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === changes)).toMatchObject({
      kind: 'change-stream',
      title: 'Changes · db.items',
    });
  });

  it('closes multiple tabs together and activates the nearest surviving tab', () => {
    const first = useWorkspaceStore.getState().openQuery({ title: 'first' });
    const second = useWorkspaceStore.getState().openQuery({ title: 'second' });
    const third = useWorkspaceStore.getState().openQuery({ title: 'third' });
    const fourth = useWorkspaceStore.getState().openQuery({ title: 'fourth' });
    useWorkspaceStore.getState().setActiveTab(third);

    useWorkspaceStore.getState().closeTabs([second, third, fourth]);

    expect(useWorkspaceStore.getState().tabs.map((tab) => tab.id)).toEqual([first]);
    expect(useWorkspaceStore.getState().activeTabId).toBe(first);
    expect(Object.keys(useWorkspaceStore.getState().results)).toEqual([first]);
  });

  it('detaches deleted connections from tabs and execution state', () => {
    const query = useWorkspaceStore.getState().createTab('query', 'deleted');
    const settings = useWorkspaceStore.getState().openConnections({ mode: 'edit', profileId: 'deleted' });
    useWorkspaceStore.getState().prepareExecution(query, 'deleted', 'run-1');

    useWorkspaceStore.getState().detachConnection('deleted');
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === query)?.connectionId).toBeNull();
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === settings)).toMatchObject({ connectionMode: 'list' });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === settings)?.profileId).toBeUndefined();
    expect(useWorkspaceStore.getState().results[query]?.status).toBe('idle');
  });

  it('opens collection tabs in Documents and seeds Query only once', () => {
    const tabId = useWorkspaceStore.getState().createTab('collection', 'conn-1');
    useWorkspaceStore.getState().updateTab(tabId, { database: 'db', collection: 'odd"/ü' });
    expect(useWorkspaceStore.getState().tabs[0]).toMatchObject({ collectionViewMode: 'documents' });

    useWorkspaceStore.getState().setCollectionView(tabId, 'query');
    expect(useWorkspaceStore.getState().tabs[0]).toMatchObject({
      collectionViewMode: 'query',
      editorContent: 'db.collection("odd\\\"/ü").find({}).limit(50);\n',
    });

    useWorkspaceStore.getState().updateTab(tabId, { editorContent: '' });
    useWorkspaceStore.getState().setCollectionView(tabId, 'documents');
    useWorkspaceStore.getState().setCollectionView(tabId, 'query');
    expect(useWorkspaceStore.getState().tabs[0]?.editorContent).toBe('');
  });

  it('keeps a Documents page-size override only for the lifetime of its collection tab', () => {
    const tabId = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'db', collection: 'items',
    });
    useWorkspaceStore.getState().updateTab(tabId, { documentsPageSizeOverride: 100 });

    const queryId = useWorkspaceStore.getState().openQuery({ connectionId: 'conn-1', database: 'db' });
    expect(useWorkspaceStore.getState().activeTabId).toBe(queryId);
    useWorkspaceStore.getState().setActiveTab(tabId);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === tabId)?.documentsPageSizeOverride)
      .toBe(100);

    useWorkspaceStore.getState().updateTab(tabId, { documentsPageSizeOverride: undefined });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === tabId)?.documentsPageSizeOverride)
      .toBeUndefined();
    useWorkspaceStore.getState().updateTab(tabId, { documentsPageSizeOverride: 100 });

    useWorkspaceStore.getState().closeTab(tabId);
    const reopenedId = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'db', collection: 'items',
    });
    expect(reopenedId).not.toBe(tabId);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === reopenedId)?.documentsPageSizeOverride)
      .toBeUndefined();
  });

  it('opens a new collection with the global Query, auto-run and page-size defaults', () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        collection: { defaultView: 'query', autoExecuteDefaultQuery: true },
        execution: { ...state.settings.execution, pageSize: 125 },
      },
    }));

    const tabId = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1',
      database: 'db',
      collection: 'odd"/ü',
    });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
      collectionViewMode: 'query',
      editorContent: 'db.collection("odd\\"/ü").find({}).limit(125);\n',
      autoExecuteOnOpen: true,
    });

    useWorkspaceStore.getState().updateTab(tabId, {
      editorContent: '// user content',
      collectionViewMode: 'documents',
      autoExecuteOnOpen: undefined,
    });
    expect(useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'db', collection: 'odd"/ü',
    })).toBe(tabId);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
      collectionViewMode: 'documents',
      editorContent: '// user content',
    });
  });

  it('allows an explicit Documents open to override the global Query default', () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        collection: { defaultView: 'query', autoExecuteDefaultQuery: true },
      },
    }));
    const tabId = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'db', collection: 'items', viewMode: 'documents',
    });
    const tab = useWorkspaceStore.getState().tabs.find((candidate) => candidate.id === tabId);
    expect(tab?.collectionViewMode).toBe('documents');
    expect(tab?.editorContent).toBeUndefined();
    expect(tab?.autoExecuteOnOpen).toBeUndefined();
  });

  it('normalizes restored legacy collection tabs to Documents', () => {
    useWorkspaceStore.getState().restore({
      tabs: [{
        id: 'legacy-collection',
        kind: 'collection',
        title: 'db.items',
        connectionId: 'conn-1',
        database: 'db',
        collection: 'items',
      }],
      activeTabId: 'legacy-collection',
    });

    expect(useWorkspaceStore.getState().tabs[0]?.collectionViewMode).toBe('documents');
  });

  it('restores a collection Query view and its edited source', () => {
    useWorkspaceStore.getState().restore({
      tabs: [{
        id: 'query-collection',
        kind: 'collection',
        title: 'db.items',
        connectionId: 'conn-1',
        database: 'db',
        collection: 'items',
        collectionViewMode: 'query',
        editorContent: '// retained\ndb.collection("items").countDocuments({});',
      }],
      activeTabId: 'query-collection',
    });

    expect(useWorkspaceStore.getState().tabs[0]).toMatchObject({
      collectionViewMode: 'query',
      editorContent: '// retained\ndb.collection("items").countDocuments({});',
    });
  });

  it('opens each saved item type once and restores reusable tab state', () => {
    const query = {
      id: 'saved-query', name: 'Daily query', type: 'query' as const, folderId: null,
      connectionId: 'conn-1', database: 'analytics', collection: null, tags: [],
      payload: { type: 'query' as const, source: 'db.events.find({ active: true })', language: 'typescript' as const, mode: 'query' as const },
      createdAt: 1, updatedAt: 1,
    };
    const queryTab = useWorkspaceStore.getState().openSavedItem(query);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === queryTab)).toMatchObject({
      kind: 'query', title: 'Daily query', savedItemId: 'saved-query', connectionId: 'conn-1',
      database: 'analytics', editorContent: 'db.events.find({ active: true })', dirty: false,
    });
    expect(useWorkspaceStore.getState().openSavedItem(query)).toBe(queryTab);

    const documentsTab = useWorkspaceStore.getState().openSavedItem({
      id: 'saved-documents', name: 'Active inventory', type: 'documents', folderId: null,
      connectionId: 'conn-1', database: 'shop', collection: 'inventory', tags: [],
      payload: { type: 'documents', criteria: { filter: '{ active: true }', sort: '{ createdAt: -1 }', projection: '{ name: 1 }' } },
      createdAt: 1, updatedAt: 1,
    });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === documentsTab)).toMatchObject({
      kind: 'collection', savedItemId: 'saved-documents', collectionViewMode: 'documents',
      documentsState: {
        draft: { filter: '{ active: true }', sort: '{ createdAt: -1 }', projection: '{ name: 1 }' },
        applied: { filter: '{ active: true }', sort: '{ createdAt: -1 }', projection: '{ name: 1 }' },
      },
    });

    const templateTab = useWorkspaceStore.getState().openSavedItem({
      id: 'saved-tab', name: 'Pinned template', type: 'tab', folderId: null,
      connectionId: null, database: 'shop', collection: 'inventory', tags: [],
      payload: {
        type: 'tab',
        template: {
          kind: 'collection', title: 'Inventory workspace', pinned: true, customTitle: true,
          collectionViewMode: 'query', editorContent: 'db.inventory.find({})', mode: 'query',
        },
      },
      createdAt: 1, updatedAt: 1,
    });
    expect(useWorkspaceStore.getState().tabs[0]?.id).toBe(templateTab);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === templateTab)).toMatchObject({
      savedItemId: 'saved-tab', pinned: true, dirty: false, connectionId: null,
      title: 'Inventory workspace', collectionViewMode: 'query',
    });
  });

  it('detaches deleted saved items without closing their tabs', () => {
    const tabId = useWorkspaceStore.getState().openSavedItem({
      id: 'saved-query', name: 'Kept content', type: 'query', folderId: null,
      connectionId: null, database: null, collection: null, tags: [],
      payload: { type: 'query', source: 'db.test.find({})', language: 'typescript', mode: 'query' },
      createdAt: 1, updatedAt: 1,
    });
    useWorkspaceStore.getState().detachSavedItems(['saved-query']);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
      editorContent: 'db.test.find({})', dirty: true,
    });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === tabId)?.savedItemId).toBeUndefined();
  });
});
