import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bulkClosableTabIds,
  useWorkspaceStore,
} from '../../../src/renderer/stores/workspace.js';
import { resetWorkspaceStores } from './helpers/workspace.js';

beforeEach(resetWorkspaceStores);

describe('workspace execution store', () => {
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
    expect(useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'db', collection: 'items', disposition: 'reuse-existing',
    })).toBe(firstCollection);

    const changes = useWorkspaceStore.getState().openChangeStream({
      connectionId: 'conn-1', database: 'db', collection: 'items',
    });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === changes)).toMatchObject({
      kind: 'change-stream',
      title: 'Changes · db.items',
    });
  });

  it('opens independent collection tabs when the disposition requests a new tab', () => {
    const first = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'db', collection: 'items', disposition: 'new-tab',
    });
    useWorkspaceStore.getState().updateTab(first, {
      documentsState: {
        draft: { filter: '{ active: true }', sort: '{}', projection: '{}' },
        applied: { filter: '{ active: true }', sort: '{}', projection: '{}' },
      },
    });
    const second = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'db', collection: 'items', disposition: 'new-tab',
    });

    expect(second).not.toBe(first);
    expect(useWorkspaceStore.getState().tabs.filter((tab) => (
      tab.kind === 'collection' && tab.database === 'db' && tab.collection === 'items'
    ))).toHaveLength(2);
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === first)?.documentsState?.applied.filter)
      .toBe('{ active: true }');
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === second)?.documentsState?.applied.filter)
      .toBe('{}');
    expect(useWorkspaceStore.getState().results[first]).not.toBe(useWorkspaceStore.getState().results[second]);
  });

  it('cleans only the closed duplicate collection tab owners', () => {
    const closeOwner = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', { mongog: { query: { closeOwner, cancel: vi.fn() } } });
    try {
      const first = useWorkspaceStore.getState().openCollection({
        connectionId: 'conn-1', database: 'db', collection: 'items', disposition: 'new-tab',
      });
      const second = useWorkspaceStore.getState().openCollection({
        connectionId: 'conn-1', database: 'db', collection: 'items', disposition: 'new-tab',
      });

      useWorkspaceStore.getState().closeTab(first);

      expect(closeOwner).toHaveBeenCalledWith('conn-1', first);
      expect(closeOwner).toHaveBeenCalledWith('conn-1', `${first}:documents`);
      expect(closeOwner).not.toHaveBeenCalledWith('conn-1', second);
      expect(closeOwner).not.toHaveBeenCalledWith('conn-1', `${second}:documents`);
      expect(useWorkspaceStore.getState().tabs.some((tab) => tab.id === second)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
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
});
