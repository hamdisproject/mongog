import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStore } from '../../src/renderer/stores/connections.js';

describe('renderer connections store collection loading', () => {
  const listCollections = vi.fn();

  beforeEach(() => {
    listCollections.mockReset();
    vi.stubGlobal('window', { mongog: { query: { listCollections } } });
    useConnectionStore.setState({ collections: {}, collectionsLoading: {} });
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
});
