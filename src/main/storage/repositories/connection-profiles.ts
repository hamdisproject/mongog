import type BetterSqlite3 from 'better-sqlite3';
import type { ConnectionProfile, ConnectionOptions } from '../../../shared/domain/connections.js';
import { appError } from '../../../shared/errors/index.js';

function rowToProfile(row: Record<string, unknown>): ConnectionProfile {
  return {
    id: row.id as string,
    groupId: (row.group_id as string) ?? null,
    name: row.name as string,
    color: (row.color as string) ?? null,
    uriRedacted: row.uri_redacted as string,
    defaultDatabase: (row.default_database as string) ?? null,
    readOnly: (row.read_only as number) === 1,
    options: JSON.parse(row.options_json as string) as ConnectionOptions,
    hasSecret: (row.has_secret as number) === 1,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export class ConnectionProfileRepo {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  list(): ConnectionProfile[] {
    const rows = this.db.prepare('SELECT * FROM connection_profiles ORDER BY name ASC').all() as Record<string, unknown>[];
    return rows.map(rowToProfile);
  }

  byId(id: string): ConnectionProfile | null {
    const row = this.db.prepare('SELECT * FROM connection_profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToProfile(row) : null;
  }

  listByGroup(groupId: string | null): ConnectionProfile[] {
    if (groupId === null) {
      const rows = this.db.prepare('SELECT * FROM connection_profiles WHERE group_id IS NULL ORDER BY name ASC').all() as Record<string, unknown>[];
      return rows.map(rowToProfile);
    }
    const rows = this.db.prepare('SELECT * FROM connection_profiles WHERE group_id = ? ORDER BY name ASC').all(groupId) as Record<string, unknown>[];
    return rows.map(rowToProfile);
  }

  insert(p: ConnectionProfile): void {
    try {
      this.db
        .prepare(
          `INSERT INTO connection_profiles
           (id, group_id, name, color, uri_redacted, default_database, read_only, has_secret, options_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          p.id,
          p.groupId,
          p.name,
          p.color,
          p.uriRedacted,
          p.defaultDatabase,
          p.readOnly ? 1 : 0,
          p.hasSecret ? 1 : 0,
          JSON.stringify(p.options),
          p.createdAt,
          p.updatedAt,
        );
    } catch (err) {
      throw appError('LocalPersistence', `Failed to insert profile: ${(err as Error).message}`);
    }
  }

  update(p: ConnectionProfile): void {
    try {
      this.db
        .prepare(
          `UPDATE connection_profiles SET
           group_id = ?, name = ?, color = ?, uri_redacted = ?, default_database = ?,
           read_only = ?, has_secret = ?, options_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          p.groupId,
          p.name,
          p.color,
          p.uriRedacted,
          p.defaultDatabase,
          p.readOnly ? 1 : 0,
          p.hasSecret ? 1 : 0,
          JSON.stringify(p.options),
          p.updatedAt,
          p.id,
        );
    } catch (err) {
      throw appError('LocalPersistence', `Failed to update profile: ${(err as Error).message}`);
    }
  }

  remove(id: string): void {
    try {
      this.db.prepare('DELETE FROM connection_profiles WHERE id = ?').run(id);
    } catch (err) {
      throw appError('LocalPersistence', `Failed to delete profile: ${(err as Error).message}`);
    }
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) c FROM connection_profiles').get() as { c: number };
    return row.c;
  }
}
