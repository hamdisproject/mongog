import type BetterSqlite3 from 'better-sqlite3';
import type { QueryHistoryEntry, HistoryQuery } from '../../../shared/domain/workspace.js';
import { appError } from '../../../shared/errors/index.js';

function rowToEntry(row: Record<string, unknown>): QueryHistoryEntry {
  return {
    id: row.id as string,
    executedAt: row.executed_at as number,
    connectionId: row.connection_id as string,
    database: row.database as string,
    script: row.script as string,
    selection: (row.selection as string) ?? undefined,
    durationMs: row.duration_ms as number,
    status: row.status as QueryHistoryEntry['status'],
    returnedCount: (row.returned_count as number) ?? undefined,
    modifiedCount: (row.modified_count as number) ?? undefined,
    favourite: (row.favourite as number) === 1,
  };
}

export class QueryHistoryRepo {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  insert(entry: QueryHistoryEntry): void {
    try {
      this.db
        .prepare(
          `INSERT INTO query_history
           (id, executed_at, connection_id, database, script, selection, duration_ms, status, returned_count, modified_count, favourite)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.id,
          entry.executedAt,
          entry.connectionId,
          entry.database,
          entry.script,
          entry.selection ?? null,
          entry.durationMs,
          entry.status,
          entry.returnedCount ?? null,
          entry.modifiedCount ?? null,
          entry.favourite ? 1 : 0,
        );
    } catch (err) {
      throw appError('LocalPersistence', `Failed to insert history: ${(err as Error).message}`);
    }
  }

  search(query: HistoryQuery): QueryHistoryEntry[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (query.text) {
      clauses.push('script LIKE ?');
      params.push(`%${query.text}%`);
    }
    if (query.connectionId) {
      clauses.push('connection_id = ?');
      params.push(query.connectionId);
    }
    if (query.database) {
      clauses.push('database = ?');
      params.push(query.database);
    }
    if (query.fromTs !== undefined) {
      clauses.push('executed_at >= ?');
      params.push(query.fromTs);
    }
    if (query.toTs !== undefined) {
      clauses.push('executed_at <= ?');
      params.push(query.toTs);
    }
    if (query.favouritesOnly) {
      clauses.push('favourite = 1');
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(query.limit ?? 100, 1000);
    const offset = query.offset ?? 0;

    const sql = `SELECT * FROM query_history ${where} ORDER BY executed_at DESC LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...params, limit, offset) as Record<string, unknown>[];
    return rows.map(rowToEntry);
  }

  byId(id: string): QueryHistoryEntry | null {
    const row = this.db.prepare('SELECT * FROM query_history WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToEntry(row) : null;
  }

  toggleFavourite(id: string): void {
    try {
      this.db.prepare('UPDATE query_history SET favourite = CASE WHEN favourite = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
    } catch (err) {
      throw appError('LocalPersistence', `Failed to toggle favourite: ${(err as Error).message}`);
    }
  }

  remove(id: string): void {
    try {
      this.db.prepare('DELETE FROM query_history WHERE id = ?').run(id);
    } catch (err) {
      throw appError('LocalPersistence', `Failed to delete history: ${(err as Error).message}`);
    }
  }

  pruneOlderThan(ts: number): number {
    const result = this.db.prepare('DELETE FROM query_history WHERE executed_at < ?').run(ts);
    return result.changes;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) c FROM query_history').get() as { c: number };
    return row.c;
  }
}
