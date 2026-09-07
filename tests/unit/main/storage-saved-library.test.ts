import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/storage/database.js';
import { useTempDatabase } from './helpers/temp-database.js';

const context = useTempDatabase('mongog-storage-test-');

describe('saved library', () => {
  it('renames saved/default database references transactionally without rewriting history or audit records', () => {
    const db = Database.openOrCreate(context.path);
    db.profiles.insert({
      id: 'c1', groupId: null, name: 'Connection', color: null,
      uriRedacted: 'mongodb://localhost', defaultDatabase: 'source',
      readOnly: false, options: {}, hasSecret: false, createdAt: 1, updatedAt: 1,
    });
    const saved = db.saved.createItem({
      name: 'Inventory', type: 'query', folderId: null, connectionId: 'c1',
      database: 'source', collection: 'items', tags: [],
      payload: { type: 'query', source: 'db.items.find({})', language: 'typescript', mode: 'query' },
    });
    db.history.insert({
      id: 'history-1', executedAt: 10, connectionId: 'c1', database: 'source',
      script: 'db.items.find({})', durationMs: 1, status: 'success', favourite: false,
    });
    db.audit.begin({
      id: 'audit-1', startedAt: 10, connectionId: 'c1', connectionName: 'Connection',
      database: 'source', category: 'documents', action: 'documents.find', origin: 'user',
      operationClass: 'read', summary: 'Historical query',
    });

    db.transaction(() => {
      db.saved.renameDatabaseContext('c1', 'source', 'target');
      const profile = db.profiles.byId('c1')!;
      db.profiles.update({ ...profile, defaultDatabase: 'target', updatedAt: 20 });
    })();

    expect(db.saved.itemById(saved.id)?.database).toBe('target');
    expect(db.profiles.byId('c1')?.defaultDatabase).toBe('target');
    expect(db.history.byId('history-1')?.database).toBe('source');
    expect(db.audit.list({}, 10, 0).entries[0]?.database).toBe('source');
    db.close();
  });

  it('creates nested folders, moves a tree across connections, and removes it recursively', () => {
    const db = Database.openOrCreate(context.path);
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
    const db = Database.openOrCreate(context.path);
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
    const legacy = new BetterSqlite3(context.path);
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

    const db = Database.openOrCreate(context.path);
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
