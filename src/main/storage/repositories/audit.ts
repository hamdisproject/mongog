import type BetterSqlite3 from 'better-sqlite3';
import type {
  AuditFilter,
  AuditListPage,
  AuditLogEntry,
  AuditSummary,
  AuditBucket,
} from '../../../shared/domain/index.js';
import { appError } from '../../../shared/errors/index.js';

export type BeginAuditInput = Omit<
  AuditLogEntry,
  'id' | 'startedAt' | 'status' | 'completedAt' | 'durationMs'
> & { id: string; startedAt: number };

export type FinishAuditInput = Pick<
  AuditLogEntry,
  'status' | 'durationMs' | 'errorCategory' | 'errorMessage' | 'resultCount' | 'affectedCount'
> & { completedAt: number; operationClass?: AuditLogEntry['operationClass'] };

export class AuditRepo {
  constructor(private readonly db: BetterSqlite3.Database) {}

  begin(entry: BeginAuditInput): void {
    try {
      this.db.prepare(`
        INSERT INTO operation_audit
          (id, correlation_id, started_at, connection_id, connection_name, database_name,
           collection_name, category, action, origin, operation_class, status, summary, detail_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
      `).run(
        entry.id,
        entry.correlationId ?? null,
        entry.startedAt,
        entry.connectionId ?? null,
        entry.connectionName,
        entry.database ?? null,
        entry.collection ?? null,
        entry.category,
        entry.action,
        entry.origin,
        entry.operationClass,
        entry.summary,
        entry.detail ? JSON.stringify(entry.detail) : null,
      );
    } catch (error) {
      throw appError('LocalPersistence', `Failed to begin audit entry: ${(error as Error).message}`);
    }
  }

  finish(id: string, update: FinishAuditInput): void {
    try {
      this.db.prepare(`
        UPDATE operation_audit SET
          completed_at = ?, duration_ms = ?, status = ?,
          operation_class = COALESCE(?, operation_class),
          error_category = ?, error_message = ?, result_count = ?, affected_count = ?
        WHERE id = ?
      `).run(
        update.completedAt,
        update.durationMs ?? null,
        update.status,
        update.operationClass ?? null,
        update.errorCategory ?? null,
        update.errorMessage ?? null,
        update.resultCount ?? null,
        update.affectedCount ?? null,
        id,
      );
    } catch (error) {
      throw appError('LocalPersistence', `Failed to finish audit entry: ${(error as Error).message}`);
    }
  }

  markRunningInterrupted(now = Date.now()): number {
    const result = this.db.prepare(`
      UPDATE operation_audit
      SET status = 'interrupted', completed_at = ?, duration_ms = MAX(0, ? - started_at)
      WHERE status = 'running'
    `).run(now, now);
    return result.changes;
  }

  list(filter: AuditFilter, limit = 100, offset = 0): AuditListPage {
    const built = buildWhere(filter);
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const safeOffset = Math.max(0, Math.trunc(offset));
    const rows = this.db.prepare(`
      SELECT * FROM operation_audit ${built.sql}
      ORDER BY started_at DESC LIMIT ? OFFSET ?
    `).all(...built.params, safeLimit, safeOffset) as Array<Record<string, unknown>>;
    const count = this.db.prepare(`SELECT COUNT(*) AS count FROM operation_audit ${built.sql}`)
      .get(...built.params) as { count: number };
    return { entries: rows.map(rowToEntry), total: count.count, limit: safeLimit, offset: safeOffset };
  }

  summary(filter: AuditFilter, bucket: AuditBucket): Omit<AuditSummary, 'health'> {
    const built = buildWhere(filter);
    const totals = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN operation_class = 'read' THEN 1 ELSE 0 END) AS reads,
        SUM(CASE WHEN operation_class = 'write' THEN 1 ELSE 0 END) AS writes,
        SUM(CASE WHEN operation_class = 'connection' THEN 1 ELSE 0 END) AS connections,
        SUM(CASE WHEN status IN ('error','interrupted') THEN 1 ELSE 0 END) AS errors,
        AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) AS average_duration
      FROM operation_audit ${built.sql}
    `).get(...built.params) as Record<string, number | null>;
    const byCategory = this.db.prepare(`
      SELECT category AS key, COUNT(*) AS count FROM operation_audit ${built.sql}
      GROUP BY category ORDER BY count DESC
    `).all(...built.params) as Array<{ key: string; count: number }>;
    const byConnection = this.db.prepare(`
      SELECT connection_id, connection_name, COUNT(*) AS count FROM operation_audit ${built.sql}
      GROUP BY connection_id, connection_name ORDER BY count DESC LIMIT 20
    `).all(...built.params) as Array<{ connection_id: string | null; connection_name: string; count: number }>;
    const bucketMs = bucket === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const timeline = this.db.prepare(`
      SELECT CAST(started_at / ? AS INTEGER) * ? AS bucket_start,
             COUNT(*) AS count,
             SUM(CASE WHEN status IN ('error','interrupted') THEN 1 ELSE 0 END) AS errors
      FROM operation_audit ${built.sql}
      GROUP BY bucket_start ORDER BY bucket_start DESC LIMIT 90
    `).all(bucketMs, bucketMs, ...built.params) as Array<{ bucket_start: number; count: number; errors: number }>;
    return {
      total: totals.total ?? 0,
      reads: totals.reads ?? 0,
      writes: totals.writes ?? 0,
      connections: totals.connections ?? 0,
      errors: totals.errors ?? 0,
      averageDurationMs: totals.average_duration ?? 0,
      byCategory,
      byConnection: byConnection.map((row) => ({
        ...(row.connection_id ? { connectionId: row.connection_id } : {}),
        connectionName: row.connection_name,
        count: row.count,
      })),
      timeline: timeline.reverse().map((row) => ({
        bucketStart: row.bucket_start,
        count: row.count,
        errors: row.errors,
      })),
    };
  }

  remove(id: string): number {
    return this.db.prepare('DELETE FROM operation_audit WHERE id = ?').run(id).changes;
  }

  clear(filter?: AuditFilter): number {
    if (!filter || Object.keys(filter).length === 0) {
      return this.db.prepare('DELETE FROM operation_audit').run().changes;
    }
    const built = buildWhere(filter);
    return this.db.prepare(`DELETE FROM operation_audit ${built.sql}`).run(...built.params).changes;
  }

  prune(retentionDays: number, maxEntries: number, now = Date.now()): number {
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    const old = this.db.prepare('DELETE FROM operation_audit WHERE started_at < ?').run(cutoff).changes;
    const overflow = this.db.prepare(`
      DELETE FROM operation_audit
      WHERE id IN (
        SELECT id FROM operation_audit ORDER BY started_at DESC LIMIT -1 OFFSET ?
      )
    `).run(maxEntries).changes;
    return old + overflow;
  }
}

function buildWhere(filter: AuditFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.text?.trim()) {
    const term = `%${filter.text.trim()}%`;
    clauses.push('(summary LIKE ? OR action LIKE ? OR connection_name LIKE ? OR database_name LIKE ? OR collection_name LIKE ? OR detail_json LIKE ?)');
    params.push(term, term, term, term, term, term);
  }
  for (const [key, column] of [
    ['connectionId', 'connection_id'],
    ['database', 'database_name'],
    ['collection', 'collection_name'],
    ['category', 'category'],
    ['action', 'action'],
    ['origin', 'origin'],
    ['status', 'status'],
  ] as const) {
    const value = filter[key];
    if (value !== undefined && value !== '') {
      clauses.push(`${column} = ?`);
      params.push(value);
    }
  }
  if (filter.fromTs !== undefined) {
    clauses.push('started_at >= ?');
    params.push(filter.fromTs);
  }
  if (filter.toTs !== undefined) {
    clauses.push('started_at <= ?');
    params.push(filter.toTs);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function rowToEntry(row: Record<string, unknown>): AuditLogEntry {
  let detail: Record<string, unknown> | undefined;
  if (typeof row.detail_json === 'string') {
    try {
      const parsed = JSON.parse(row.detail_json) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) detail = parsed as Record<string, unknown>;
    } catch {
      detail = { value: '[unreadable audit detail]' };
    }
  }
  return {
    id: String(row.id),
    ...(row.correlation_id ? { correlationId: String(row.correlation_id) } : {}),
    startedAt: Number(row.started_at),
    ...(row.completed_at !== null ? { completedAt: Number(row.completed_at) } : {}),
    ...(row.duration_ms !== null ? { durationMs: Number(row.duration_ms) } : {}),
    ...(row.connection_id ? { connectionId: String(row.connection_id) } : {}),
    connectionName: String(row.connection_name),
    ...(row.database_name ? { database: String(row.database_name) } : {}),
    ...(row.collection_name ? { collection: String(row.collection_name) } : {}),
    category: row.category as AuditLogEntry['category'],
    action: String(row.action),
    origin: row.origin as AuditLogEntry['origin'],
    operationClass: row.operation_class as AuditLogEntry['operationClass'],
    status: row.status as AuditLogEntry['status'],
    summary: String(row.summary),
    ...(detail ? { detail } : {}),
    ...(row.error_category ? { errorCategory: String(row.error_category) } : {}),
    ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
    ...(row.result_count !== null ? { resultCount: Number(row.result_count) } : {}),
    ...(row.affected_count !== null ? { affectedCount: Number(row.affected_count) } : {}),
  };
}
