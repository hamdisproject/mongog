import type BetterSqlite3 from 'better-sqlite3';
import { appError } from '../../../shared/errors/index.js';

export interface SecretRow {
  key: string;
  blob: Buffer;
  createdAt: number;
  updatedAt: number;
}

export class SecretsRepo {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  upsert(key: string, blob: Buffer): void {
    try {
      const now = Date.now();
      this.db
        .prepare(
          `INSERT INTO secrets (key, blob, created_at, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at`,
        )
        .run(key, blob, now, now);
    } catch (err) {
      throw appError('LocalPersistence', `Failed to store secret: ${(err as Error).message}`);
    }
  }

  getBlob(key: string): Buffer | null {
    const row = this.db.prepare('SELECT blob FROM secrets WHERE key = ?').get(key) as { blob: Buffer } | undefined;
    return row?.blob ?? null;
  }

  remove(key: string): void {
    try {
      this.db.prepare('DELETE FROM secrets WHERE key = ?').run(key);
    } catch (err) {
      throw appError('LocalPersistence', `Failed to delete secret: ${(err as Error).message}`);
    }
  }

  has(key: string): boolean {
    const row = this.db.prepare('SELECT 1 e FROM secrets WHERE key = ?').get(key) as { e: number } | undefined;
    return row !== undefined;
  }

  allKeys(): string[] {
    const rows = this.db.prepare('SELECT key FROM secrets').all() as { key: string }[];
    return rows.map((r) => r.key);
  }
}
