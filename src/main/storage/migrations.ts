import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

interface Migration {
  version: number;
  description: string;
  up: (db: BetterSqlite3.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Initial schema: connection profiles, groups, secrets, history, workspace, settings, scripts',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS connection_groups (
          id          TEXT PRIMARY KEY NOT NULL,
          name        TEXT NOT NULL,
          collapsed   INTEGER NOT NULL DEFAULT 0,
          sort_order  INTEGER NOT NULL DEFAULT 0,
          created_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS connection_profiles (
          id                TEXT PRIMARY KEY NOT NULL,
          group_id          TEXT REFERENCES connection_groups(id) ON DELETE SET NULL,
          name              TEXT NOT NULL,
          color             TEXT,
          uri_redacted      TEXT NOT NULL,
          default_database  TEXT,
          read_only         INTEGER NOT NULL DEFAULT 0,
          has_secret        INTEGER NOT NULL DEFAULT 0,
          options_json      TEXT NOT NULL DEFAULT '{}',
          created_at        INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS secrets (
          key         TEXT PRIMARY KEY NOT NULL,
          blob        BLOB NOT NULL,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS query_history (
          id              TEXT PRIMARY KEY NOT NULL,
          executed_at     INTEGER NOT NULL,
          connection_id   TEXT NOT NULL REFERENCES connection_profiles(id) ON DELETE CASCADE,
          database        TEXT NOT NULL,
          script          TEXT NOT NULL,
          selection       TEXT,
          duration_ms     INTEGER NOT NULL,
          status          TEXT NOT NULL CHECK(status IN ('success','error','cancelled')),
          returned_count  INTEGER,
          modified_count  INTEGER,
          favourite       INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_history_connection ON query_history(connection_id);
        CREATE INDEX IF NOT EXISTS idx_history_executed  ON query_history(executed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_history_favourite  ON query_history(favourite) WHERE favourite = 1;

        CREATE TABLE IF NOT EXISTS workspace_state (
          id       TEXT PRIMARY KEY NOT NULL DEFAULT 'default',
          state    TEXT NOT NULL,
          version  INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS settings (
          key    TEXT PRIMARY KEY NOT NULL,
          value  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS saved_scripts (
          id              TEXT PRIMARY KEY NOT NULL,
          name            TEXT NOT NULL,
          folder          TEXT,
          tags_json       TEXT NOT NULL DEFAULT '[]',
          connection_id   TEXT REFERENCES connection_profiles(id) ON DELETE SET NULL,
          database_name   TEXT,
          content         TEXT NOT NULL,
          language        TEXT NOT NULL DEFAULT 'javascript' CHECK(language IN ('javascript','typescript')),
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_scripts_folder ON saved_scripts(folder);
      `);
    },
  },
  {
    version: 2,
    description: 'Hierarchical saved folders and typed saved items',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS saved_folders (
          id              TEXT PRIMARY KEY NOT NULL,
          name            TEXT NOT NULL,
          connection_id   TEXT REFERENCES connection_profiles(id) ON DELETE SET NULL,
          parent_id       TEXT REFERENCES saved_folders(id) ON DELETE CASCADE,
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_saved_folders_connection
          ON saved_folders(connection_id, parent_id);

        CREATE TABLE IF NOT EXISTS saved_items (
          id              TEXT PRIMARY KEY NOT NULL,
          name            TEXT NOT NULL,
          item_type       TEXT NOT NULL CHECK(item_type IN ('query','documents','tab')),
          folder_id       TEXT REFERENCES saved_folders(id) ON DELETE CASCADE,
          connection_id   TEXT REFERENCES connection_profiles(id) ON DELETE SET NULL,
          database_name   TEXT,
          collection_name TEXT,
          tags_json       TEXT NOT NULL DEFAULT '[]',
          payload_json    TEXT NOT NULL,
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_saved_items_connection
          ON saved_items(connection_id, folder_id);
        CREATE INDEX IF NOT EXISTS idx_saved_items_type ON saved_items(item_type);
      `);

      const legacyExists = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'saved_scripts'",
      ).get();
      if (!legacyExists) return;

      const legacyRows = db.prepare('SELECT * FROM saved_scripts ORDER BY created_at ASC').all() as Array<{
        id: string;
        name: string;
        folder: string | null;
        tags_json: string;
        connection_id: string | null;
        database_name: string | null;
        content: string;
        language: 'javascript' | 'typescript';
        created_at: number;
        updated_at: number;
      }>;
      const folders = new Map<string, string>();
      const insertFolder = db.prepare(`
        INSERT INTO saved_folders
          (id, name, connection_id, parent_id, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?)
      `);
      const insertItem = db.prepare(`
        INSERT INTO saved_items
          (id, name, item_type, folder_id, connection_id, database_name, collection_name,
           tags_json, payload_json, created_at, updated_at)
        VALUES (?, ?, 'query', ?, ?, ?, NULL, ?, ?, ?, ?)
      `);

      for (const row of legacyRows) {
        let folderId: string | null = null;
        if (row.folder) {
          const folderKey = `${row.connection_id ?? '<unassigned>'}\u0000${row.folder}`;
          folderId = folders.get(folderKey) ?? null;
          if (!folderId) {
            folderId = randomUUID();
            folders.set(folderKey, folderId);
            insertFolder.run(
              folderId,
              row.folder,
              row.connection_id,
              row.created_at,
              row.updated_at,
            );
          }
        }
        insertItem.run(
          row.id,
          row.name,
          folderId,
          row.connection_id,
          row.database_name,
          row.tags_json,
          JSON.stringify({
            type: 'query',
            source: row.content,
            language: row.language,
            mode: 'query',
          }),
          row.created_at,
          row.updated_at,
        );
      }

      db.exec('DROP TABLE saved_scripts');
    },
  },
];

export function migrateUp(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version   INTEGER PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const userVersion = db.pragma('user_version', { simple: true }) as number;
  const recordedVersions = new Set(
    (db.prepare('SELECT version FROM _migrations').all() as { version: number }[])
      .map((row) => row.version),
  );

  for (const m of migrations) {
    if (m.version <= userVersion) continue;

    // Older Phase 1 databases recorded migrations before user_version was
    // adopted. Their idempotent migration is replayed once to synchronize the
    // SQLite-native version without losing the audit row.
    const apply = db.transaction(() => {
      m.up(db);
      if (!recordedVersions.has(m.version)) {
        db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)')
          .run(m.version, Date.now());
      }
      db.pragma(`user_version = ${m.version}`);
    });
    apply();
  }
}
