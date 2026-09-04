import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStore } from '../../src/renderer/stores/connections.js';

describe('renderer connections store collection loading', () => {
  const listCollections = vi.fn();
  const listDatabases = vi.fn();
  const connect = vi.fn();
  const getState = vi.fn();

  beforeEach(() => {
    listCollections.mockReset();
    listDatabases.mockReset();
    listDatabases.mockResolvedValue([]);
    connect.mockReset();
    connect.mockResolvedValue(undefined);
    getState.mockReset();
    getState.mockResolvedValue({ status: 'connected', pid: 123, serverVersion: '8.0.0' });
    vi.stubGlobal('window', {
      mongog: {
        query: { listCollections, listDatabases },
        connections: { connect, getState },
      },
    });
    useConnectionStore.setState({
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
});
