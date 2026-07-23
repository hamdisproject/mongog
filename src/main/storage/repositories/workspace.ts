import type BetterSqlite3 from 'better-sqlite3';
import type { WorkspaceState } from '../../../shared/domain/workspace.js';
import { appError } from '../../../shared/errors/index.js';

export class WorkspaceRepo {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  get(id = 'default'): WorkspaceState | null {
    const row = this.db.prepare('SELECT state FROM workspace_state WHERE id = ?').get(id) as { state: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.state) as WorkspaceState;
    } catch {
      return null;
    }
  }

  upsert(state: WorkspaceState, id = 'default'): void {
    try {
      this.db
        .prepare(
          `INSERT INTO workspace_state (id, state, version) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET state = excluded.state, version = excluded.version`,
        )
        .run(id, JSON.stringify(state), state.version);
    } catch (err) {
      throw appError('LocalPersistence', `Failed to save workspace: ${(err as Error).message}`);
    }
  }

  remove(id = 'default'): void {
    this.db.prepare('DELETE FROM workspace_state WHERE id = ?').run(id);
  }
}
