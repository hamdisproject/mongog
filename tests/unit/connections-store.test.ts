import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStore } from '../../src/renderer/stores/connections.js';
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.js';

describe('renderer connections store collection loading', () => {
  const listCollections = vi.fn();
  const listDatabases = vi.fn();
  const connect = vi.fn();
  const getState = vi.fn();
  const createDatabase = vi.fn();
  const startDatabaseRename = vi.fn();
  const closeOwner = vi.fn();

  beforeEach(() => {
    listCollections.mockReset();
    listDatabases.mockReset();
    listDatabases.mockResolvedValue([]);
    connect.mockReset();
    connect.mockResolvedValue(undefined);
    getState.mockReset();
    getState.mockResolvedValue({ status: 'connected', pid: 123, serverVersion: '8.0.0' });
    createDatabase.mockReset();
    startDatabaseRename.mockReset();
    closeOwner.mockReset();
    closeOwner.mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      mongog: {
        query: {
          listCollections,
          listDatabases,
          createDatabase,
          startDatabaseRename,
          closeOwner,
          cancel: vi.fn(),
        },
        connections: { connect, getState },
        saved: { list: vi.fn().mockResolvedValue({ folders: [], items: [] }) },
      },
    });
    useConnectionStore.setState({
      profiles: [],
      connected: {},
      runtimeEpochs: {},
      errors: {},
      idleDisconnects: {},
      databases: {},
      collections: {},
      collectionsLoading: {},
      expandedProfileIds: new Set(),
      expandedDatabaseIds: new Set(),
    });
    useWorkspaceStore.setState({ tabs: [], activeTabId: null, results: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('distinguishes an in-flight collection request from a loaded empty database', async () => {
    let resolveRequest!: (collections: []) => void;
    listCollections.mockReturnValue(new Promise<[]>((resolve) => {
      resolveRequest = resolve;
    }));

    const first = useConnectionStore.getState().loadCollections('conn-1', 'app');
    const duplicate = useConnectionStore.getState().loadCollections('conn-1', 'app');
    expect(useConnectionStore.getState().collectionsLoading['conn-1:app']).toBe(true);
    expect(useConnectionStore.getState().collections['conn-1:app']).toBeUndefined();
    expect(listCollections).toHaveBeenCalledOnce();

    resolveRequest([]);
    await Promise.all([first, duplicate]);
    expect(useConnectionStore.getState().collectionsLoading['conn-1:app']).toBeUndefined();
    expect(useConnectionStore.getState().collections['conn-1:app']).toEqual([]);
  });

  it('clears the loading marker when collection discovery fails', async () => {
    listCollections.mockRejectedValue(new Error('disconnected'));
    await useConnectionStore.getState().loadCollections('conn-1', 'app');

    expect(useConnectionStore.getState().collectionsLoading['conn-1:app']).toBeUndefined();
    expect(useConnectionStore.getState().collections['conn-1:app']).toBeUndefined();
  });

  it('retains idle disconnect context until the connection starts again', () => {
    useConnectionStore.setState({
      connected: { 'conn-1': { pid: 123, serverVersion: '8.0.0' } },
      databases: { 'conn-1': [{ name: 'app' }] },
    });

    useConnectionStore.getState().applyRuntimeState({
      connectionId: 'conn-1',
      status: 'disconnected',
      reason: 'idle',
      since: 123_456,
      idleTimeoutMS: 3_600_000,
    });

    expect(useConnectionStore.getState().connected['conn-1']).toBeUndefined();
    expect(useConnectionStore.getState().databases['conn-1']).toBeUndefined();
    expect(useConnectionStore.getState().idleDisconnects['conn-1']).toEqual({
      since: 123_456,
      idleTimeoutMS: 3_600_000,
    });

    useConnectionStore.getState().applyRuntimeState({ connectionId: 'conn-1', status: 'connecting' });
    expect(useConnectionStore.getState().idleDisconnects['conn-1']).toBeUndefined();
  });

  it('invalidates runtime-owned state once when a query cancel restarts the connection', () => {
    useConnectionStore.setState({
      connected: { 'conn-1': { pid: 123, serverVersion: '8.0.0' } },
      databases: { 'conn-1': [{ name: 'app' }] },
      collections: { 'conn-1:app': [{ name: 'items' }] },
    });

    useConnectionStore.getState().applyRuntimeState({
      connectionId: 'conn-1',
      status: 'restarting',
      reason: 'query-cancel',
      executionId: 'exec-1',
      since: 123_456,
    });

    expect(useConnectionStore.getState().connected['conn-1']).toBeUndefined();
    expect(useConnectionStore.getState().databases['conn-1']).toBeUndefined();
    expect(useConnectionStore.getState().collections['conn-1:app']).toBeUndefined();
    expect(useConnectionStore.getState().runtimeEpochs['conn-1']).toBe(1);
  });

  it('reloads databases and expands the profile after a restarted runtime reconnects', async () => {
    listDatabases.mockResolvedValue([{ name: 'app' }]);
    useConnectionStore.setState({
      connected: {},
      databases: {},
      expandedProfileIds: new Set(),
    });

    useConnectionStore.getState().applyRuntimeState({
      connectionId: 'conn-1',
      status: 'connected',
      runtimePid: 456,
      serverVersion: '8.0.1',
      connectedAt: 123_457,
    });

    await vi.waitFor(() => {
      expect(useConnectionStore.getState().databases['conn-1']).toEqual([{ name: 'app' }]);
    });
    expect(listDatabases).toHaveBeenCalledWith('conn-1');
    expect(useConnectionStore.getState().expandedProfileIds.has('conn-1')).toBe(true);
  });

  it('expands a profile after an explicit connection succeeds', async () => {
    await useConnectionStore.getState().connect('conn-1');

    expect(connect).toHaveBeenCalledWith('conn-1');
    expect(useConnectionStore.getState().connected['conn-1']).toEqual({
      pid: 123,
      serverVersion: '8.0.0',
    });
    expect(useConnectionStore.getState().expandedProfileIds.has('conn-1')).toBe(true);
    expect(listDatabases).toHaveBeenCalledWith('conn-1');
  });

  it('creates the first collection and expands the new database', async () => {
    createDatabase.mockResolvedValue({ database: 'new_app', collection: 'items' });

    await useConnectionStore.getState().createDatabase('conn-1', 'new_app', 'items');

    expect(createDatabase).toHaveBeenCalledWith({
      connectionId: 'conn-1', database: 'new_app', collection: 'items',
    });
    expect(useConnectionStore.getState().databases['conn-1']).toEqual([{ name: 'new_app' }]);
    expect(useConnectionStore.getState().collections['conn-1:new_app']).toEqual([
      { name: 'items', type: 'collection' },
    ]);
    expect(useConnectionStore.getState().expandedDatabaseIds.has('conn-1:new_app')).toBe(true);
  });

  it('applies a completed rename to profiles, Explorer data, and open tabs', async () => {
    listDatabases.mockResolvedValue([{ name: 'target' }]);
    listCollections.mockResolvedValue([{ name: 'items', type: 'collection' }]);
    const profile = {
      id: 'conn-1', groupId: null, name: 'Connection', color: null,
      uriRedacted: 'mongodb://localhost', defaultDatabase: 'source', readOnly: false,
      options: {}, hasSecret: false, createdAt: 1, updatedAt: 1,
    };
    useConnectionStore.setState({
      profiles: [profile],
      databases: { 'conn-1': [{ name: 'source' }] },
      collections: { 'conn-1:source': [{ name: 'items', type: 'collection' }] },
      expandedDatabaseIds: new Set(['conn-1:source']),
    });
    const tabId = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'source', collection: 'items',
    });

    await useConnectionStore.getState().applyDatabaseRenameProgress({
      jobId: 'rename-1', connectionId: 'conn-1', sourceDatabase: 'source', targetDatabase: 'target',
      status: 'completed', collectionCount: 1, movedCount: 1,
      movedCollections: ['items'], remainingCollections: [],
    });

    expect(useConnectionStore.getState().profiles[0]?.defaultDatabase).toBe('target');
    expect(useConnectionStore.getState().databases['conn-1']).toEqual([{ name: 'target' }]);
    expect(useConnectionStore.getState().collections['conn-1:source']).toBeUndefined();
    expect(useConnectionStore.getState().collections['conn-1:target']).toEqual([
      { name: 'items', type: 'collection' },
    ]);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
      database: 'target', title: 'target.items',
    });
    expect(closeOwner).toHaveBeenCalledWith('conn-1', tabId);
  });

  it('refreshes both server namespaces after partial failure without rewriting local context', async () => {
    listDatabases.mockResolvedValue([{ name: 'source' }, { name: 'target' }]);
    listCollections.mockImplementation(async (_connectionId: string, database: string) => (
      database === 'source'
        ? [{ name: 'remaining', type: 'collection' }]
        : [{ name: 'moved', type: 'collection' }]
    ));
    const profile = {
      id: 'conn-1', groupId: null, name: 'Connection', color: null,
      uriRedacted: 'mongodb://localhost', defaultDatabase: 'source', readOnly: false,
      options: {}, hasSecret: false, createdAt: 1, updatedAt: 1,
    };
    useConnectionStore.setState({ profiles: [profile] });
    const tabId = useWorkspaceStore.getState().openQuery({
      connectionId: 'conn-1', database: 'source', title: 'source query',
    });

    await useConnectionStore.getState().applyDatabaseRenameProgress({
      jobId: 'rename-1', connectionId: 'conn-1', sourceDatabase: 'source', targetDatabase: 'target',
      status: 'failed', collectionCount: 2, movedCount: 1,
      movedCollections: ['moved'], remainingCollections: ['remaining'],
    });

    expect(useConnectionStore.getState().profiles[0]?.defaultDatabase).toBe('source');
    expect(useConnectionStore.getState().collections['conn-1:source']).toEqual([
      { name: 'remaining', type: 'collection' },
    ]);
    expect(useConnectionStore.getState().collections['conn-1:target']).toEqual([
      { name: 'moved', type: 'collection' },
    ]);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === tabId)?.database).toBe('source');
  });
});
