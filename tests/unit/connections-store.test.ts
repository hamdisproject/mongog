import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStore } from '../../src/renderer/stores/connections.js';

describe('renderer connections store collection loading', () => {
  const listCollections = vi.fn();

  beforeEach(() => {
    listCollections.mockReset();
    vi.stubGlobal('window', { mongog: { query: { listCollections } } });
    useConnectionStore.setState({
      connected: {},
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
});
