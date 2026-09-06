import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/storage/database.js';
import { useTempDatabase } from './helpers/temp-database.js';

const context = useTempDatabase('mongog-storage-test-');

describe('operation audit', () => {
  it('pages, filters, summarizes and prunes activity entries', () => {
    const db = Database.openOrCreate(context.path);
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
    let db = Database.openOrCreate(context.path);
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

    const raw = new BetterSqlite3(context.path);
    raw.exec('DROP TABLE operation_audit; DELETE FROM _migrations WHERE version = 3; PRAGMA user_version = 2;');
    raw.close();

    db = Database.openOrCreate(context.path);
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
