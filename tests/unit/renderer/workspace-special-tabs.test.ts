import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bulkClosableTabIds,
  useWorkspaceStore,
} from '../../../src/renderer/stores/workspace.js';
import { resetWorkspaceStores } from './helpers/workspace.js';

beforeEach(resetWorkspaceStores);

describe('workspace execution store', () => {
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

  it('reuses and restores one closeable, non-renamable Release Notes tab', () => {
    const first = useWorkspaceStore.getState().openReleaseNotes();
    const second = useWorkspaceStore.getState().openReleaseNotes();
    expect(second).toBe(first);
    expect(useWorkspaceStore.getState().renameTab(first, 'Changelog')).toBe(false);

    useWorkspaceStore.getState().restore({
      tabs: [
        { id: 'query-1', kind: 'query', title: 'Query', connectionId: null },
        { id: 'release-1', kind: 'release-notes', title: 'Old title', connectionId: null },
        { id: 'release-2', kind: 'release-notes', title: 'Duplicate', connectionId: null },
      ],
      activeTabId: 'release-2',
    });
    const tabs = useWorkspaceStore.getState().tabs;
    expect(tabs.filter((tab) => tab.kind === 'release-notes')).toHaveLength(1);
    expect(tabs.find((tab) => tab.kind === 'release-notes')).toMatchObject({
      id: 'release-1', title: 'Release Notes', customTitle: false,
    });
    expect(useWorkspaceStore.getState().activeTabId).toBe('release-1');

    useWorkspaceStore.getState().closeTab('release-1');
    expect(useWorkspaceStore.getState().tabs.some((tab) => tab.kind === 'release-notes')).toBe(false);
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
    const releaseNotes = useWorkspaceStore.getState().openReleaseNotes();

    expect(useWorkspaceStore.getState().renameTab(collection, '  My inventory  ')).toBe(true);
    expect(useWorkspaceStore.getState().renameTab(settings, 'Preferences')).toBe(false);
    expect(useWorkspaceStore.getState().renameTab(releaseNotes, 'Changelog')).toBe(false);
    useWorkspaceStore.getState().renameCollectionContext('conn-1', 'db', 'items', 'products');

    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === collection)).toMatchObject({
      title: 'My inventory',
      collection: 'products',
      customTitle: true,
    });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === settings)?.title).toBe('Settings');
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === releaseNotes)?.title).toBe('Release Notes');
  });

  it('moves open tabs to a renamed database, preserves custom titles, and clears runtime results', () => {
    const collection = useWorkspaceStore.getState().openCollection({
      connectionId: 'conn-1', database: 'source', collection: 'items',
    });
    const query = useWorkspaceStore.getState().openQuery({
      connectionId: 'conn-1', database: 'source', title: 'source query',
    });
    const unaffected = useWorkspaceStore.getState().openQuery({
      connectionId: 'conn-1', database: 'other', title: 'other query',
    });
    useWorkspaceStore.getState().renameTab(query, 'Inventory report');
    useWorkspaceStore.getState().prepareExecution(collection, 'conn-1', 'run-collection');
    useWorkspaceStore.getState().prepareExecution(query, 'conn-1', 'run-query');

    useWorkspaceStore.getState().renameDatabaseContext('conn-1', 'source', 'target');

    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === collection)).toMatchObject({
      database: 'target',
      title: 'target.items',
    });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === query)).toMatchObject({
      database: 'target',
      title: 'Inventory report',
      customTitle: true,
    });
    expect(useWorkspaceStore.getState().tabs.find((tab) => tab.id === unaffected)).toMatchObject({
      database: 'other',
      title: 'other query',
    });
    expect(useWorkspaceStore.getState().results[collection]?.status).toBe('idle');
    expect(useWorkspaceStore.getState().results[query]?.status).toBe('idle');
  });

  it('excludes pinned tabs from every bulk-close selection', () => {
    const tabs = [
      { id: 'pinned', kind: 'settings', title: 'Settings', connectionId: null, pinned: true },
      { id: 'left', kind: 'query', title: 'Left', connectionId: null },
      { id: 'current', kind: 'query', title: 'Current', connectionId: null },
      { id: 'right', kind: 'query', title: 'Right', connectionId: null },
    ] satisfies import('../../../src/shared/domain/index.js').WorkspaceTab[];

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
});
