import type BetterSqlite3 from 'better-sqlite3';
import type { ApplicationSettings } from '../../../shared/domain/workspace.js';
import { appError } from '../../../shared/errors/index.js';

export class SettingsRepo {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  get(): ApplicationSettings | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as ApplicationSettings;
    } catch {
      return null;
    }
  }

  upsert(settings: ApplicationSettings): void {
    try {
      this.db
        .prepare(
          `INSERT INTO settings (key, value) VALUES ('app', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(JSON.stringify(settings));
    } catch (err) {
      throw appError('LocalPersistence', `Failed to save settings: ${(err as Error).message}`);
    }
  }

  getRaw(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setRaw(key: string, value: string): void {
    try {
      this.db
        .prepare(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(key, value);
    } catch (err) {
      throw appError('LocalPersistence', `Failed to set setting: ${(err as Error).message}`);
    }
  }

  remove(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }
}
