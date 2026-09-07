import { describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/storage/database.js';
import { useTempDatabase } from './helpers/temp-database.js';

const context = useTempDatabase('mongog-storage-test-');

describe('connection groups', () => {
  it('inserts, lists, updates, and removes groups', () => {
    const db = Database.openOrCreate(context.path);

    expect(db.groups.count()).toBe(0);

    db.groups.insert({ id: 'g1', name: 'Production', collapsed: false, sortOrder: 0, createdAt: 100 });
    db.groups.insert({ id: 'g2', name: 'Staging', collapsed: true, sortOrder: 1, createdAt: 200 });

    expect(db.groups.count()).toBe(2);

    const list = db.groups.list();
    expect(list).toHaveLength(2);

    const g1 = db.groups.byId('g1');
    expect(g1).not.toBeNull();
    expect(g1!.name).toBe('Production');

    db.groups.update({ id: 'g1', name: 'Prod', collapsed: false, sortOrder: 0, createdAt: 100 });
    expect(db.groups.byId('g1')!.name).toBe('Prod');

    db.groups.remove('g1');
    expect(db.groups.byId('g1')).toBeNull();
    expect(db.groups.count()).toBe(1);

    db.close();
  });
});

describe('connection profiles', () => {
  it('inserts, lists, and removes profiles', () => {
    const db = Database.openOrCreate(context.path);

    db.groups.insert({ id: 'g1', name: 'Group', collapsed: false, sortOrder: 0, createdAt: 100 });

    db.profiles.insert({
      id: 'p1',
      groupId: 'g1',
      name: 'Local',
      color: '#00ff00',
      uriRedacted: 'mongodb://localhost:27017',
      defaultDatabase: 'test',
      readOnly: false,
      options: { connectTimeoutMS: 5000 },
      hasSecret: false,
      createdAt: 100,
      updatedAt: 100,
    });

    expect(db.profiles.count()).toBe(1);

    const byGroup = db.profiles.listByGroup('g1');
    expect(byGroup).toHaveLength(1);
    expect(byGroup[0]!.name).toBe('Local');

    const p1 = db.profiles.byId('p1')!;
    expect(p1.uriRedacted).toBe('mongodb://localhost:27017');
    expect(p1.options.connectTimeoutMS).toBe(5000);

    db.profiles.update({ ...p1, name: 'Local Updated' });
    expect(db.profiles.byId('p1')!.name).toBe('Local Updated');

    db.profiles.remove('p1');
    expect(db.profiles.byId('p1')).toBeNull();
    expect(db.profiles.count()).toBe(0);

    db.close();
  });
});

describe('secrets repo', () => {
  it('stores and retrieves binary blobs', () => {
    const db = Database.openOrCreate(context.path);

    db.secrets.upsert('key1', Buffer.from('encrypted-data'));
    expect(db.secrets.has('key1')).toBe(true);
    expect(db.secrets.getBlob('key1')!.toString()).toBe('encrypted-data');

    db.secrets.upsert('key1', Buffer.from('updated-data'));
    expect(db.secrets.getBlob('key1')!.toString()).toBe('updated-data');

    expect(db.secrets.allKeys()).toEqual(['key1']);

    db.secrets.remove('key1');
    expect(db.secrets.has('key1')).toBe(false);

    db.close();
  });
});

describe('query history', () => {
  it('inserts, searches, and prunes entries', () => {
    const db = Database.openOrCreate(context.path);
    db.profiles.insert({
      id: 'c1', groupId: null, name: 'HistConn', color: null,
      uriRedacted: 'mongodb://h', defaultDatabase: null,
      readOnly: false, options: {}, hasSecret: false, createdAt: 1, updatedAt: 1,
    });

    db.history.insert({
      id: 'h1', executedAt: 1000, connectionId: 'c1', database: 'test',
      script: 'db.findOne()', durationMs: 5, status: 'success', favourite: false,
    });
    db.history.insert({
      id: 'h2', executedAt: 2000, connectionId: 'c1', database: 'test',
      script: 'db.insertOne({})', durationMs: 10, status: 'success', returnedCount: 1, favourite: true,
    });

    expect(db.history.count()).toBe(2);

    const results = db.history.search({ text: 'findOne' });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('h1');

    const favs = db.history.search({ favouritesOnly: true });
    expect(favs).toHaveLength(1);

    db.history.toggleFavourite('h1');
    expect(db.history.byId('h1')!.favourite).toBe(true);

    db.history.remove('h2');
    expect(db.history.count()).toBe(1);

    const pruned = db.history.pruneOlderThan(1500);
    expect(pruned).toBe(1);
    expect(db.history.count()).toBe(0);

    db.close();
  });
});

describe('workspace state', () => {
  it('saves and loads workspace state', () => {
    const db = Database.openOrCreate(context.path);

    expect(db.workspace.get()).toBeNull();

    db.workspace.upsert({
      version: 1, sidebarWidth: 300, expandedNodeKeys: [], tabs: [], activeTabId: null,
    });

    const state = db.workspace.get()!;
    expect(state.sidebarWidth).toBe(300);

    db.workspace.remove();
    expect(db.workspace.get()).toBeNull();

    db.close();
  });
});

describe('settings', () => {
  it('saves and loads application settings', () => {
    const db = Database.openOrCreate(context.path);

    expect(db.settings.get()).toBeNull();

    db.settings.upsert({
      schemaVersion: 1, theme: 'dark',
      editor: { fontSize: 14, mouseWheelZoom: true, tabSize: 2, wordWrap: false, minimap: false },
      connection: { idleTimeoutMS: 3600000 },
      execution: { defaultTimeoutMS: 30000, pageSize: 50, maxRetainedPages: 20, maxPreviewBytes: 256000, cursorIdleTimeoutMS: 600000, maxRuntimes: 10, confirmDestructive: true },
      history: { retentionDays: 90, maxEntries: 10000 },
      audit: { retentionDays: 90, maxEntries: 50000 },
      collection: {
        defaultView: 'documents',
        autoExecuteDefaultQuery: false,
        explorerOpenBehavior: 'reuse-existing',
        criteriaOpenByDefault: true,
      },
      catalog: { databaseOrder: 'alphabetical', collectionOrder: 'alphabetical' },
      toolbar: { query: true, sql: true, search: true, transfer: true },
      table: { columnOrder: 'alphabetical' },
      ejson: { defaultMode: 'relaxed' },
    });

    const loaded = db.settings.get()!;
    expect(loaded.theme).toBe('dark');
    expect(loaded.editor.fontSize).toBe(14);

    db.settings.setRaw('custom:key', 'custom-val');
    expect(db.settings.getRaw('custom:key')).toBe('custom-val');
    db.settings.remove('custom:key');
    expect(db.settings.getRaw('custom:key')).toBeNull();

    db.close();
  });
});
