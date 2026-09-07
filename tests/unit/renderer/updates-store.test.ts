import { beforeEach, describe, expect, it } from 'vitest';
import { useUpdatesStore } from '../../../src/renderer/stores/updates.js';

describe('updates store event state', () => {
  beforeEach(() => {
    useUpdatesStore.getState().reset();
  });

  it('retains the update version across download progress events', () => {
    const store = useUpdatesStore.getState();
    store.applyPayload({ phase: 'available', version: '2.0.0' });
    store.applyPayload({ phase: 'downloading', progress: 25 });

    expect(useUpdatesStore.getState()).toMatchObject({
      phase: 'downloading',
      availableVersion: '2.0.0',
      progress: 25,
      error: null,
    });
  });

  it('clears stale version, progress, and errors on a terminal neutral state', () => {
    const store = useUpdatesStore.getState();
    store.applyPayload({ phase: 'available', version: '2.0.0' });
    store.applyPayload({ phase: 'downloading', version: '2.0.0', progress: 60 });
    store.applyPayload({ phase: 'error', error: 'network down' });
    store.applyPayload({ phase: 'up-to-date' });

    expect(useUpdatesStore.getState()).toMatchObject({
      phase: 'up-to-date',
      availableVersion: null,
      progress: null,
      error: null,
    });
  });
});
