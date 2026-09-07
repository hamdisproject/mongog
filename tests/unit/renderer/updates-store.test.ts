import { beforeEach, describe, expect, it } from 'vitest';
import { useUpdatesStore } from '../../../src/renderer/stores/updates.js';

describe('updates store event state', () => {
  beforeEach(() => {
    useUpdatesStore.getState().reset();
  });

  it('retains the update version across download progress events', () => {
    const store = useUpdatesStore.getState();
    store.applyPayload({ phase: 'available', delivery: 'in-app', version: '2.0.0' });
    store.applyPayload({ phase: 'downloading', delivery: 'in-app', progress: 25 });

    expect(useUpdatesStore.getState()).toMatchObject({
      phase: 'downloading',
      availableVersion: '2.0.0',
      progress: 25,
      error: null,
    });
  });

  it('clears stale version, progress, and errors on a terminal neutral state', () => {
    const store = useUpdatesStore.getState();
    store.applyPayload({ phase: 'available', delivery: 'in-app', version: '2.0.0' });
    store.applyPayload({ phase: 'downloading', delivery: 'in-app', version: '2.0.0', progress: 60 });
    store.applyPayload({ phase: 'error', delivery: 'in-app', error: 'network down' });
    store.applyPayload({ phase: 'up-to-date', delivery: 'in-app' });

    expect(useUpdatesStore.getState()).toMatchObject({
      phase: 'up-to-date',
      availableVersion: null,
      progress: null,
      error: null,
    });
  });

  it('stores the trusted website delivery policy from update events', () => {
    useUpdatesStore.getState().applyPayload({
      phase: 'available',
      delivery: 'website',
      version: '2.0.0',
    });

    expect(useUpdatesStore.getState()).toMatchObject({
      phase: 'available',
      delivery: 'website',
      availableVersion: '2.0.0',
    });
  });
});
