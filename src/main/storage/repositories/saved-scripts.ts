import type BetterSqlite3 from 'better-sqlite3';
import type { SavedScript } from '../../../shared/domain/workspace.js';
import { appError } from '../../../shared/errors/index.js';

function rowToScript(row: Record<string, unknown>): SavedScript {
  return {
    id: row.id as string,
    name: row.name as string,
    folder: (row.folder as string) ?? null,
    tags: JSON.parse(row.tags_json as string) as string[],
    connectionId: (row.connection_id as string) ?? null,
    database: (row.database_name as string) ?? null,
    content: row.content as string,
    language: row.language as SavedScript['language'],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export class SavedScriptsRepo {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  list(): SavedScript[] {
    const rows = this.db.prepare('SELECT * FROM saved_scripts ORDER BY folder ASC, name ASC').all() as Record<string, unknown>[];
    return rows.map(rowToScript);
  }

  byId(id: string): SavedScript | null {
    const row = this.db.prepare('SELECT * FROM saved_scripts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToScript(row) : null;
  }

  listByFolder(folder: string | null): SavedScript[] {
    if (folder === null) {
      const rows = this.db.prepare('SELECT * FROM saved_scripts WHERE folder IS NULL ORDER BY name ASC').all() as Record<string, unknown>[];
      return rows.map(rowToScript);
    }
    const rows = this.db.prepare('SELECT * FROM saved_scripts WHERE folder = ? ORDER BY name ASC').all(folder) as Record<string, unknown>[];
    return rows.map(rowToScript);
  }

  insert(s: SavedScript): void {
    try {
      this.db
        .prepare(
          `INSERT INTO saved_scripts
           (id, name, folder, tags_json, connection_id, database_name, content, language, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(s.id, s.name, s.folder, JSON.stringify(s.tags), s.connectionId, s.database, s.content, s.language, s.createdAt, s.updatedAt);
    } catch (err) {
      throw appError('LocalPersistence', `Failed to insert script: ${(err as Error).message}`);
    }
  }

  update(s: SavedScript): void {
    try {
      this.db
        .prepare(
          `UPDATE saved_scripts SET
           name = ?, folder = ?, tags_json = ?, connection_id = ?, database_name = ?,
           content = ?, language = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(s.name, s.folder, JSON.stringify(s.tags), s.connectionId, s.database, s.content, s.language, Date.now(), s.id);
    } catch (err) {
      throw appError('LocalPersistence', `Failed to update script: ${(err as Error).message}`);
    }
  }

  remove(id: string): void {
    try {
      this.db.prepare('DELETE FROM saved_scripts WHERE id = ?').run(id);
    } catch (err) {
      throw appError('LocalPersistence', `Failed to delete script: ${(err as Error).message}`);
    }
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) c FROM saved_scripts').get() as { c: number };
    return row.c;
  }
}
