import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/storage/database.js';
import { AuditService } from '../../../src/main/services/audit-service.js';

const opened: Array<{ db: Database; directory: string }> = [];

afterEach(() => {
  for (const item of opened.splice(0)) {
    item.db.close();
    rmSync(item.directory, { recursive: true, force: true });
  }
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'mongog-audit-service-'));
  const db = Database.openOrCreate(join(directory, 'audit.db'));
  opened.push({ db, directory });
  const service = new AuditService(db);
  service.initialize();
  return { db, service };
}

describe('AuditService', () => {
  it('records successful and failed operations without changing operation errors', async () => {
    const { db, service } = setup();
    const value = await service.run({
      connectionName: 'Local', category: 'documents', action: 'documents.count', origin: 'user',
      operationClass: 'read', summary: 'Count documents', detail: { filter: '{ active: true }' },
    }, async () => 42, (count) => ({ resultCount: count }));
    expect(value).toBe(42);

    const original = new Error('driver failed');
    await expect(service.run({
      connectionName: 'Local', category: 'documents', action: 'documents.find', origin: 'user',
      operationClass: 'read', summary: 'Find documents',
    }, async () => { throw original; })).rejects.toBe(original);

    expect(db.audit.list({ status: 'success' }, 10, 0).entries[0]).toMatchObject({
      action: 'documents.count', resultCount: 42,
    });
    expect(db.audit.list({ status: 'error' }, 10, 0).entries[0]).toMatchObject({
      action: 'documents.find', errorMessage: 'driver failed',
    });
  });

  it('redacts an entire safe-detail payload when credential material is detected', async () => {
    const { db, service } = setup();
    await service.run({
      connectionName: 'Temporary connection', category: 'query', action: 'query.execute', origin: 'user',
      operationClass: 'read', summary: 'Execute query',
      detail: { source: 'const uri = "mongodb://user:secret@host/db"; db.items.find({})' },
    }, async () => undefined);

    const entry = db.audit.list({}, 10, 0).entries[0]!;
    expect(entry.detail).toEqual({ value: '[redacted: credential material detected]' });
    expect(JSON.stringify(entry)).not.toContain('secret@host');
  });

  it('bounds stored safe details to 32 KiB even for multibyte source text', async () => {
    const { db, service } = setup();
    await service.run({
      connectionName: 'Local', category: 'query', action: 'query.execute', origin: 'user',
      operationClass: 'read', summary: 'Execute query', detail: { source: '漢'.repeat(40_000) },
    }, async () => undefined);

    const detail = db.audit.list({}, 10, 0).entries[0]!.detail!;
    expect(detail).toMatchObject({ truncated: true });
    expect(Buffer.byteLength(JSON.stringify(detail), 'utf8')).toBeLessThanOrEqual(32 * 1024);
  });

  it('completes asynchronous query rows from engine events with real counts and duration', () => {
    const { db, service } = setup();
    service.beginQuery({
      correlationId: 'run-1', connectionName: 'Local', database: 'test', category: 'query',
      action: 'query.execute', origin: 'user', operationClass: 'read', summary: 'Execute query',
      detail: { source: 'db.items.updateMany({}, { $set: { active: true } })' },
    });
    service.handleEngineEvent('run-1', {
      type: 'result', index: 0, range: { startLine: 1, startCol: 1, endLine: 1, endCol: 2 }, durationMs: 11,
      result: { kind: 'write', op: 'update', matchedCount: 4, modifiedCount: 3 },
    });
    service.handleEngineEvent('run-1', { type: 'execution-finished', status: 'completed', durationMs: 18 });

    expect(db.audit.list({}, 10, 0).entries[0]).toMatchObject({
      correlationId: 'run-1', status: 'success', durationMs: 18,
      operationClass: 'write', affectedCount: 3,
    });
  });

  it('records the hard-cancel target as cancelled and other connection work as interrupted', () => {
    const { db, service } = setup();
    for (const correlationId of ['target-run', 'other-run']) {
      service.beginQuery({
        correlationId,
        connectionId: 'conn-1',
        connectionName: 'Local',
        database: 'test',
        category: 'query',
        action: 'query.execute',
        origin: 'user',
        operationClass: 'read',
        summary: 'Execute query',
      });
    }

    service.cancelQuery('target-run');
    service.failQueriesForConnection('conn-1', 'runtime restarted');

    expect(db.audit.list({ status: 'cancelled' }, 10, 0).entries[0]).toMatchObject({
      correlationId: 'target-run',
      errorCategory: 'Cancellation',
    });
    expect(db.audit.list({ status: 'interrupted' }, 10, 0).entries[0]).toMatchObject({
      correlationId: 'other-run',
      errorMessage: 'runtime restarted',
    });
  });

  it('marks unfinished rows interrupted during initialization and exposes health in summaries', () => {
    const { db, service } = setup();
    service.begin({
      connectionName: 'Local', category: 'connection', action: 'connection.connect', origin: 'user',
      operationClass: 'connection', summary: 'Connect',
    });
    const restarted = new AuditService(db);
    restarted.initialize();
    expect(db.audit.list({ status: 'interrupted' }, 10, 0).total).toBe(1);
    expect(restarted.summary({}, 'day').health).toEqual({ healthy: true });
  });

  it('completes asynchronous export rows without storing destination paths or data', () => {
    const { db, service } = setup();
    service.beginExport({
      correlationId: 'export-1', connectionId: 'connection-1', connectionName: 'Local',
      database: 'shop', collection: 'orders', category: 'export', action: 'export.documents',
      origin: 'user', operationClass: 'read', summary: 'Export collection documents as CSV',
      detail: { format: 'csv', scope: 'all-matching' },
    });
    service.handleExportEvent({
      jobId: 'export-1', connectionId: 'connection-1', status: 'completed', phase: 'finalizing',
      processedRows: 125, totalRows: 125, filename: 'shop_orders.csv', warningCount: 0,
    });

    const entry = db.audit.list({ category: 'export' }, 10, 0).entries[0]!;
    expect(entry).toMatchObject({ status: 'success', resultCount: 125, database: 'shop', collection: 'orders' });
    expect(JSON.stringify(entry)).not.toContain('/');
    expect(entry.detail).toEqual({ format: 'csv', scope: 'all-matching' });
  });
});
