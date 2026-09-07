import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/storage/database.js';
import { useTempDatabase } from './helpers/temp-database.js';

const context = useTempDatabase('mongog-storage-test-');

describe('open / lifecycle', () => {
  it('opens and creates tables on first use', () => {
    const db = Database.openOrCreate(context.path);
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
    const db1 = Database.openOrCreate(context.path);
    db1.close();

    const db2 = Database.openOrCreate(context.path);
    const tables = db2.prepare(
      "SELECT count(*) c FROM sqlite_master WHERE type='table'",
    ).get() as { c: number };
    expect(tables.c).toBeGreaterThan(0);
    db2.close();
  });

  it('rejects readonly when file does not exist', () => {
    expect(() => Database.openReadonly(join(context.directory, 'nonexistent.db'))).toThrow();
  });
});

describe('backup and integrity', () => {
  it('creates a consistent backup', () => {
    const db = Database.openOrCreate(context.path);
    db.profiles.insert({
      id: 'p1', groupId: null, name: 'Test', color: null, uriRedacted: 'mongodb://host',
      defaultDatabase: null, readOnly: false, options: {}, hasSecret: false,
      createdAt: 100, updatedAt: 100,
    });

    const backupPath = join(context.directory, `backup-${Date.now()}.db`);
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
    const db = Database.openOrCreate(context.path);
    db.close();

    const corrupted = join(context.directory, `corrupt-${Date.now()}.db`);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(corrupted, 'not-a-sqlite-db');

    const ok = await db.tryRecover(corrupted);
    expect(ok).toBe(false);
  });
});

describe('concurrent safety', () => {
  it('uses WAL mode', () => {
    const db = Database.openOrCreate(context.path);
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(row.journal_mode.toLowerCase()).toBe('wal');
    db.close();
  });

  it('has foreign keys enabled', () => {
    const db = Database.openOrCreate(context.path);
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
    db.close();
  });
});
