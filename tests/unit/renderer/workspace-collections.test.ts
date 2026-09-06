import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bulkClosableTabIds,
  useWorkspaceStore,
} from '../../../src/renderer/stores/workspace.js';
import { useSettingsStore } from '../../../src/renderer/stores/settings.js';
import { resetWorkspaceStores } from './helpers/workspace.js';

beforeEach(resetWorkspaceStores);

describe('workspace execution store', () => {
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

  it('keeps a manual Documents column order only for the lifetime of its collection tab', () => {
    const tabId = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'db', collection: 'items',
    });
    useWorkspaceStore.getState().updateTab(tabId, {
      documentsColumnOrder: ['_id', 'quantity', 'sku'],
      documentsColumnOrderManual: true,
    });

    const queryId = useWorkspaceStore.getState().openQuery({ connectionId: 'conn-1', database: 'db' });
    useWorkspaceStore.getState().setActiveTab(tabId);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
      documentsColumnOrder: ['_id', 'quantity', 'sku'],
      documentsColumnOrderManual: true,
    });
    expect(useWorkspaceStore.getState().activeTabId).toBe(tabId);
    expect(queryId).not.toBe(tabId);

    useWorkspaceStore.getState().closeTab(tabId);
    const reopenedId = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'db', collection: 'items',
    });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === reopenedId)?.documentsColumnOrder)
      .toBeUndefined();
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === reopenedId)?.documentsColumnOrderManual)
      .toBeUndefined();
  });

  it('opens a new collection with the global Query, auto-run and page-size defaults', () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        collection: {
          ...state.settings.collection,
          defaultView: 'query',
          autoExecuteDefaultQuery: true,
        },
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
        collection: {
          ...state.settings.collection,
          defaultView: 'query',
          autoExecuteDefaultQuery: true,
        },
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

  it('seeds the SQL view once and keeps it separate from the Query source', () => {
    const tabId = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'db', collection: 'items',
    });

    useWorkspaceStore.getState().setCollectionView(tabId, 'sql');
    expect(useWorkspaceStore.getState().tabs[0]).toMatchObject({
      collectionViewMode: 'sql',
      sqlEditorContent: 'SELECT * FROM items LIMIT 50;\n',
    });

    useWorkspaceStore.getState().updateTab(tabId, { sqlEditorContent: '-- edited' });
    useWorkspaceStore.getState().setCollectionView(tabId, 'query');
    useWorkspaceStore.getState().setCollectionView(tabId, 'sql');
    expect(useWorkspaceStore.getState().tabs[0]).toMatchObject({
      sqlEditorContent: '-- edited',
      editorContent: expect.stringContaining('db.collection("items")'),
    });
  });

  it('coerces an unknown restored collection view back to Documents', () => {
    useWorkspaceStore.getState().restore({
      tabs: [{
        id: 'odd-view',
        kind: 'collection',
        title: 'db.items',
        connectionId: 'conn-1',
        database: 'db',
        collection: 'items',
        collectionViewMode: 'visual' as unknown as 'documents',
      }],
      activeTabId: 'odd-view',
    });

    expect(useWorkspaceStore.getState().tabs[0]?.collectionViewMode).toBe('documents');
  });

  it('restores a collection SQL view with its own source', () => {
    useWorkspaceStore.getState().restore({
      tabs: [{
        id: 'sql-collection',
        kind: 'collection',
        title: 'db.items',
        connectionId: 'conn-1',
        database: 'db',
        collection: 'items',
        collectionViewMode: 'sql',
        sqlEditorContent: 'SELECT status FROM items LIMIT 10;\n',
      }],
      activeTabId: 'sql-collection',
    });

    expect(useWorkspaceStore.getState().tabs[0]).toMatchObject({
      collectionViewMode: 'sql',
      sqlEditorContent: 'SELECT status FROM items LIMIT 10;\n',
    });
  });
});
