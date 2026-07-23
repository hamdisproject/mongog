import type BetterSqlite3 from 'better-sqlite3';

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
