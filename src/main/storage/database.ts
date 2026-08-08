import { statSync } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';
import { appError } from '../../shared/errors/index.js';
import { migrateUp } from './migrations.js';
import { ConnectionProfileRepo } from './repositories/connection-profiles.js';
import { ConnectionGroupRepo } from './repositories/connection-groups.js';
import { QueryHistoryRepo } from './repositories/query-history.js';
import { WorkspaceRepo } from './repositories/workspace.js';
import { SettingsRepo } from './repositories/settings.js';
import { SecretsRepo } from './repositories/secrets.js';
import { SavedLibraryRepo } from './repositories/saved-library.js';
import { AuditRepo } from './repositories/audit.js';

export interface DbConfig {
  path: string;
  readonly?: boolean;
}

export interface BackupInfo {
  path: string;
  sizeBytes: number;
  pageCount: number;
}

export class Database {
  private db: BetterSqlite3.Database;
  readonly profiles: ConnectionProfileRepo;
  readonly groups: ConnectionGroupRepo;
  readonly secrets: SecretsRepo;
  readonly history: QueryHistoryRepo;
  readonly workspace: WorkspaceRepo;
  readonly settings: SettingsRepo;
  readonly saved: SavedLibraryRepo;
  readonly audit: AuditRepo;

  private constructor(db: BetterSqlite3.Database) {
    this.db = db;
    this.profiles = new ConnectionProfileRepo(db);
    this.groups = new ConnectionGroupRepo(db);
    this.secrets = new SecretsRepo(db);
    this.history = new QueryHistoryRepo(db);
    this.workspace = new WorkspaceRepo(db);
    this.settings = new SettingsRepo(db);
    this.saved = new SavedLibraryRepo(db);
    this.audit = new AuditRepo(db);
  }

  static open(config: DbConfig): Database {
    let db: BetterSqlite3.Database | undefined;
    try {
      db = new BetterSqlite3(config.path, {
        readonly: config.readonly ?? false,
        fileMustExist: config.readonly ?? false,
      });
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 5000');

      if (!config.readonly) {
        migrateUp(db);
      }

      return new Database(db);
    } catch (err) {
      db?.close();
      throw appError('LocalPersistence', `Failed to open database: ${(err as Error).message}`, {
        causeMessage: (err as Error).stack,
      });
    }
  }

  static openOrCreate(path: string): Database {
    return Database.open({ path, readonly: false });
  }

  static openReadonly(path: string): Database {
    return Database.open({ path, readonly: true });
  }

  exec(sql: string, ...params: unknown[]): BetterSqlite3.RunResult {
    try {
      return this.db.prepare(sql).run(...params);
    } catch (err) {
      throw appError('LocalPersistence', `SQL exec failed: ${(err as Error).message}`);
    }
  }

  prepare(sql: string): BetterSqlite3.Statement {
    return this.db.prepare(sql);
  }

  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
    return this.db.transaction(fn) as unknown as T;
  }

  close(): void {
    this.db.close();
  }

  checkIntegrity(): string | null {
    try {
      const row = this.db.prepare('PRAGMA integrity_check').get() as { 'integrity_check': string } | undefined;
      if (row && row.integrity_check !== 'ok') {
        return row.integrity_check;
      }
      return null;
    } catch {
      return 'integrity_check query failed';
    }
  }

  backup(targetPath: string): BackupInfo {
    try {
      this.db.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
      const pc = this.db.prepare('PRAGMA page_count').get() as { page_count: number };
      const { size } = statSync(targetPath);
      return { path: targetPath, sizeBytes: size, pageCount: pc.page_count };
    } catch (err) {
      throw appError('LocalPersistence', `Backup failed: ${(err as Error).message}`);
    }
  }

  async tryRecover(targetPath: string): Promise<boolean> {
    try {
      const recovered = new BetterSqlite3(targetPath, { readonly: true });
      const row = recovered.prepare('PRAGMA integrity_check').get() as { 'integrity_check': string };
      recovered.close();
      return row.integrity_check === 'ok';
    } catch {
      return false;
    }
  }
}
