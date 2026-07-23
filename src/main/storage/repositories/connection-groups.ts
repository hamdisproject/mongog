import type BetterSqlite3 from 'better-sqlite3';
import type { ConnectionGroup } from '../../../shared/domain/connections.js';
import { appError } from '../../../shared/errors/index.js';

function rowToGroup(row: Record<string, unknown>): ConnectionGroup {
  return {
    id: row.id as string,
    name: row.name as string,
    collapsed: (row.collapsed as number) === 1,
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as number,
  };
}

export class ConnectionGroupRepo {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  list(): ConnectionGroup[] {
    const rows = this.db.prepare('SELECT * FROM connection_groups ORDER BY sort_order ASC, name ASC').all() as Record<string, unknown>[];
    return rows.map(rowToGroup);
  }

  byId(id: string): ConnectionGroup | null {
    const row = this.db.prepare('SELECT * FROM connection_groups WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToGroup(row) : null;
  }

  insert(g: ConnectionGroup): void {
    try {
      this.db
        .prepare(
          'INSERT INTO connection_groups (id, name, collapsed, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(g.id, g.name, g.collapsed ? 1 : 0, g.sortOrder, g.createdAt);
    } catch (err) {
      throw appError('LocalPersistence', `Failed to insert group: ${(err as Error).message}`);
    }
  }

  update(g: ConnectionGroup): void {
    try {
      this.db
        .prepare('UPDATE connection_groups SET name = ?, collapsed = ?, sort_order = ? WHERE id = ?')
        .run(g.name, g.collapsed ? 1 : 0, g.sortOrder, g.id);
    } catch (err) {
      throw appError('LocalPersistence', `Failed to update group: ${(err as Error).message}`);
    }
  }

  remove(id: string): void {
    try {
      this.db.prepare('DELETE FROM connection_groups WHERE id = ?').run(id);
    } catch (err) {
      throw appError('LocalPersistence', `Failed to delete group: ${(err as Error).message}`);
    }
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) c FROM connection_groups').get() as { c: number };
    return row.c;
  }
}
