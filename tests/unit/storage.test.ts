import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { Database } from '../../src/main/storage/database.js';

let tmpDir: string;
let dbPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mongog-storage-test-'));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  dbPath = join(tmpDir, `test-${Date.now()}.db`);
});

describe('Database', () => {
  describe('open / lifecycle', () => {
    it('opens and creates tables on first use', () => {
      const db = Database.openOrCreate(dbPath);
      expect(db.checkIntegrity()).toBeNull();

      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      ).all() as { name: string }[];

      const names = tables.map((t) => t.name);
      expect(names).toContain('connection_profiles');
      expect(names).toContain('connection_groups');
      expect(names).toContain('secrets');
      expect(names).toContain('query_history');
      expect(names).toContain('workspace_state');
      expect(names).toContain('settings');
      expect(names).toContain('saved_folders');
      expect(names).toContain('saved_items');
      expect(names).toContain('operation_audit');
      expect(names).not.toContain('saved_scripts');
      expect(names).toContain('_migrations');

      const userVersion = db.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(userVersion.user_version).toBe(3);

      db.close();
    });

    it('re-opens existing database without re-running migrations', () => {
      const db1 = Database.openOrCreate(dbPath);
      db1.close();

      const db2 = Database.openOrCreate(dbPath);
      const tables = db2.prepare(
        "SELECT count(*) c FROM sqlite_master WHERE type='table'",
      ).get() as { c: number };
      expect(tables.c).toBeGreaterThan(0);
      db2.close();
    });

    it('rejects readonly when file does not exist', () => {
      expect(() => Database.openReadonly(join(tmpDir, 'nonexistent.db'))).toThrow();
    });
  });

  describe('connection groups', () => {
    it('inserts, lists, updates, and removes groups', () => {
      const db = Database.openOrCreate(dbPath);

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
      const db = Database.openOrCreate(dbPath);

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
      const db = Database.openOrCreate(dbPath);

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
      const db = Database.openOrCreate(dbPath);
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
      const db = Database.openOrCreate(dbPath);

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
      const db = Database.openOrCreate(dbPath);

      expect(db.settings.get()).toBeNull();

      db.settings.upsert({
        schemaVersion: 1, theme: 'dark',
        editor: { fontSize: 14, tabSize: 2, wordWrap: false, minimap: false },
        connection: { idleTimeoutMS: 3600000 },
        execution: { defaultTimeoutMS: 30000, pageSize: 50, maxRetainedPages: 20, maxPreviewBytes: 256000, cursorIdleTimeoutMS: 600000, maxRuntimes: 10, confirmDestructive: true },
        history: { retentionDays: 90, maxEntries: 10000 },
        audit: { retentionDays: 90, maxEntries: 50000 },
        collection: { defaultView: 'documents', autoExecuteDefaultQuery: false },
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

  describe('operation audit', () => {
    it('pages, filters, summarizes and prunes activity entries', () => {
      const db = Database.openOrCreate(dbPath);
      db.audit.begin({
        id: 'audit-1', startedAt: 1_000, connectionId: 'deleted-connection', connectionName: 'Production',
        database: 'sales', collection: 'orders', category: 'documents', action: 'documents.find',
        origin: 'user', operationClass: 'read', summary: 'Find orders', detail: { filter: '{ status: "open" }' },
      });
      db.audit.finish('audit-1', {
        completedAt: 1_025, durationMs: 25, status: 'success', resultCount: 12,
      });
      db.audit.begin({
        id: 'audit-2', startedAt: 2_000, connectionName: 'Production', database: 'sales',
        category: 'query', action: 'query.execute', origin: 'user', operationClass: 'write',
        summary: 'Update order',
      });
      db.audit.finish('audit-2', {
        completedAt: 2_100, durationMs: 100, status: 'error', errorCategory: 'MongoServerError',
        errorMessage: 'write failed', affectedCount: 0,
      });

      expect(db.audit.list({ connectionId: 'deleted-connection' }, 10, 0).entries).toHaveLength(1);
      expect(db.audit.list({ text: 'orders' }, 10, 0).entries[0]?.detail).toEqual({ filter: '{ status: "open" }' });
      expect(db.audit.list({ status: 'error' }, 1, 0)).toMatchObject({ total: 1, limit: 1, offset: 0 });
      expect(db.audit.summary({ database: 'sales' }, 'day')).toMatchObject({
        total: 2, reads: 1, writes: 1, errors: 1, averageDurationMs: 62.5,
      });

      expect(db.audit.prune(1, 1, 2_000)).toBe(1);
      expect(db.audit.list({}, 10, 0).entries.map((entry) => entry.id)).toEqual(['audit-2']);
      db.close();
    });

    it('recovers running entries and migrates legacy query history with a durable connection snapshot', () => {
      let db = Database.openOrCreate(dbPath);
      db.profiles.insert({
        id: 'legacy-connection', groupId: null, name: 'Legacy Cluster', color: null,
        uriRedacted: 'mongodb://legacy', defaultDatabase: 'reports', readOnly: false,
        options: {}, hasSecret: false, createdAt: 1, updatedAt: 1,
      });
      db.history.insert({
        id: 'legacy-query', executedAt: 5_000, connectionId: 'legacy-connection', database: 'reports',
        script: 'db.orders.find({ open: true })', durationMs: 17, status: 'success',
        returnedCount: 3, favourite: false,
      });
      db.close();

      const raw = new BetterSqlite3(dbPath);
      raw.exec('DROP TABLE operation_audit; DELETE FROM _migrations WHERE version = 3; PRAGMA user_version = 2;');
      raw.close();

      db = Database.openOrCreate(dbPath);
      const migrated = db.audit.list({ action: 'query.execute' }, 10, 0).entries[0]!;
      expect(migrated).toMatchObject({
        connectionId: 'legacy-connection', connectionName: 'Legacy Cluster', database: 'reports',
        status: 'success', resultCount: 3,
      });
      expect(migrated.detail).toMatchObject({ source: 'db.orders.find({ open: true })' });
      db.profiles.remove('legacy-connection');
      expect(db.audit.list({}, 10, 0).entries[0]?.connectionName).toBe('Legacy Cluster');

      db.audit.begin({
        id: 'running-entry', startedAt: 8_000, connectionName: 'Temporary connection',
        category: 'connection', action: 'connection.test', origin: 'user', operationClass: 'connection',
        summary: 'Test connection',
      });
      expect(db.audit.markRunningInterrupted(8_120)).toBe(1);
      expect(db.audit.list({ status: 'interrupted' }, 10, 0).entries[0]).toMatchObject({ durationMs: 120 });
      db.close();
    });
  });

  describe('saved library', () => {
    it('creates nested folders, moves a tree across connections, and removes it recursively', () => {
      const db = Database.openOrCreate(dbPath);
      db.profiles.insert({
        id: 'c1', groupId: null, name: 'ScriptConn', color: null,
        uriRedacted: 'mongodb://h', defaultDatabase: null,
        readOnly: false, options: {}, hasSecret: false, createdAt: 1, updatedAt: 1,
      });
      db.profiles.insert({
        id: 'c2', groupId: null, name: 'OtherConn', color: null,
        uriRedacted: 'mongodb://other', defaultDatabase: null,
        readOnly: false, options: {}, hasSecret: false, createdAt: 1, updatedAt: 1,
      });

      const root = db.saved.createFolder({ name: 'Queries', connectionId: 'c1', parentId: null });
      const child = db.saved.createFolder({ name: 'Reports', connectionId: 'c1', parentId: root.id });
      const grandchild = db.saved.createFolder({ name: 'Daily', connectionId: 'c1', parentId: child.id });
      const item = db.saved.createItem({
        name: 'Active users', type: 'query', folderId: grandchild.id, connectionId: 'c1',
        database: 'test', collection: null, tags: ['read'],
        payload: { type: 'query', source: 'db.users.find({ active: true })', language: 'typescript', mode: 'query' },
      });

      expect(db.saved.list().folders).toHaveLength(3);
      expect(db.saved.itemById(item.id)?.payload).toMatchObject({ type: 'query' });
      expect(() => db.saved.updateFolder({
        id: root.id, name: root.name, connectionId: 'c1', parentId: grandchild.id,
      })).toThrow(/descendant/i);

      db.saved.updateFolder({ id: root.id, name: 'Moved', connectionId: 'c2', parentId: null });
      expect(db.saved.folderById(grandchild.id)?.connectionId).toBe('c2');
      expect(db.saved.itemById(item.id)?.connectionId).toBe('c2');

      const removed = db.saved.deleteFolder(root.id);
      expect(removed.deletedFolderIds).toEqual(expect.arrayContaining([root.id, child.id, grandchild.id]));
      expect(removed.deletedItemIds).toEqual([item.id]);
      expect(db.saved.list()).toEqual({ folders: [], items: [] });

      db.close();
    });

    it('detaches saved content when its connection is deleted', () => {
      const db = Database.openOrCreate(dbPath);
      db.profiles.insert({
        id: 'c1', groupId: null, name: 'ScriptConn', color: null,
        uriRedacted: 'mongodb://h', defaultDatabase: null,
        readOnly: false, options: {}, hasSecret: false, createdAt: 1, updatedAt: 1,
      });
      const folder = db.saved.createFolder({ name: 'Queries', connectionId: 'c1', parentId: null });
      const item = db.saved.createItem({
        name: 'Ping', type: 'query', folderId: folder.id, connectionId: 'c1', database: 'admin',
        collection: null, tags: [],
        payload: { type: 'query', source: 'await db.command({ ping: 1 })', language: 'typescript', mode: 'query' },
      });

      db.profiles.remove('c1');
      expect(db.saved.folderById(folder.id)?.connectionId).toBeNull();
      expect(db.saved.itemById(item.id)?.connectionId).toBeNull();
      db.close();
    });

    it('migrates legacy flat saved scripts without losing content', () => {
      const legacy = new BetterSqlite3(dbPath);
      legacy.exec(`
        CREATE TABLE connection_profiles (id TEXT PRIMARY KEY);
        CREATE TABLE saved_scripts (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          folder TEXT,
          tags_json TEXT NOT NULL DEFAULT '[]',
          connection_id TEXT,
          database_name TEXT,
          content TEXT NOT NULL,
          language TEXT NOT NULL DEFAULT 'javascript',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE _migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL);
        INSERT INTO _migrations VALUES (1, 1);
        INSERT INTO saved_scripts VALUES
          ('legacy-1', 'Legacy find', 'Reports', '["legacy"]', NULL, 'test', 'db.users.find({})', 'javascript', 10, 20);
        PRAGMA user_version = 1;
      `);
      legacy.close();

      const db = Database.openOrCreate(dbPath);
      const snapshot = db.saved.list();
      expect(snapshot.folders).toHaveLength(1);
      expect(snapshot.folders[0]?.name).toBe('Reports');
      expect(snapshot.items).toHaveLength(1);
      expect(snapshot.items[0]).toMatchObject({
        id: 'legacy-1', name: 'Legacy find', type: 'query', database: 'test', tags: ['legacy'],
        payload: { type: 'query', source: 'db.users.find({})', language: 'javascript', mode: 'query' },
      });
      db.close();
    });
  });

  describe('backup and integrity', () => {
    it('creates a consistent backup', () => {
      const db = Database.openOrCreate(dbPath);
      db.profiles.insert({
        id: 'p1', groupId: null, name: 'Test', color: null, uriRedacted: 'mongodb://host',
        defaultDatabase: null, readOnly: false, options: {}, hasSecret: false,
        createdAt: 100, updatedAt: 100,
      });

      const backupPath = join(tmpDir, `backup-${Date.now()}.db`);
      const info = db.backup(backupPath);

      expect(info.path).toBe(backupPath);
      expect(info.sizeBytes).toBeGreaterThan(0);
      expect(info.pageCount).toBeGreaterThan(0);

      const backupDb = Database.openOrCreate(backupPath);
      expect(backupDb.profiles.count()).toBe(1);
      backupDb.close();

      db.close();
    });

    it('detects integrity failure on corrupt file', async () => {
      const db = Database.openOrCreate(dbPath);
      db.close();

      const corrupted = join(tmpDir, `corrupt-${Date.now()}.db`);
      const { writeFileSync } = await import('node:fs');
      writeFileSync(corrupted, 'not-a-sqlite-db');

      const ok = await db.tryRecover(corrupted);
      expect(ok).toBe(false);
    });
  });

  describe('concurrent safety', () => {
    it('uses WAL mode', () => {
      const db = Database.openOrCreate(dbPath);
      const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(row.journal_mode.toLowerCase()).toBe('wal');
      db.close();
    });

    it('has foreign keys enabled', () => {
      const db = Database.openOrCreate(dbPath);
      const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      expect(row.foreign_keys).toBe(1);
      db.close();
    });
  });
});
