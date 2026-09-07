# Local storage (SQLite schema, migrations, repos)

Lives in main only: `src/main/storage/database.ts`,
`src/main/storage/migrations.ts`, `src/main/storage/repositories/*`.
The renderer NEVER touches SQLite — it goes through IPC + repos.
Rationale: `docs/adr/0010-local-persistence.md`.

## Open parameters

`Database.open({ path, readonly })`: `journal_mode = WAL`,
`foreign_keys = ON`, `busy_timeout = 5000`. Migrations run on every writable
open; readonly opens skip them (`openReadonly` sets `fileMustExist`).
Failures throw `AppError('LocalPersistence', …)` — never raw sqlite errors.
`checkIntegrity()` (`PRAGMA integrity_check`), `backup()` (`VACUUM INTO` with
quote-escaped path → `{ path, sizeBytes, pageCount }`), `tryRecover()` (readonly
open + integrity check, boolean). Production path:
`join(app.getPath('userData'), 'mongog.db')` (`src/main/main.ts`).

## Schema (3 migrations — append-only, never edit an applied one)

| Version | Content |
|---|---|
| v1 | `connection_groups`, `connection_profiles` (`uri_redacted` NOT NULL — never a credentialed URI), `secrets` (opaque `blob` only), `query_history`, `workspace_state`, `settings`, `saved_scripts` + history/folder indexes |
| v2 | `saved_folders` + `saved_items` (`item_type ∈ query/documents/tab`), with a data backfill that migrates every `saved_scripts` row into folders/items and then `DROP`s the legacy table |
| v3 | `operation_audit` (CHECK-constrained `origin`/`operation_class`/`status`, 5 indexes) + backfill from `query_history` |

Runner: `migrateUp()` in `migrations.ts:280-310`. Version tracked BOTH in
`_migrations(version, applied_at)` and `PRAGMA user_version`; each migration
applies inside one `db.transaction`, records the row if missing (Phase 1 DBs
predate `user_version`), then bumps `user_version`. `CREATE … IF NOT EXISTS`
everywhere so a partially-applied migration can safely re-run.

## Adding a migration (v4 template)

1. Append `{ version: 4, description: '…', up(db) { db.exec(`…`); } }` to the
   `migrations` array. Never touch v1–v3.
2. New tables need `IF NOT EXISTS`; new indexes `IF NOT EXISTS`; data backfills
   must be idempotent (`INSERT OR IGNORE`, `SELECT FROM sqlite_master` guard —
   copy the v2/v3 pattern).
3. Backfills that copy user script text MUST pass it through
   `containsKnownSecretMaterial` / `redactForLog` like v3 does
   (`migrations.ts:251-257`) — a migration is a persistence write like any other.
4. Add/extend the repo in `repositories/` (one class per table group, takes
   `BetterSqlite3.Database`, exposes typed methods over `Database.exec/prepare/
   transaction`), expose it on the `Database` class, cover with
   `tests/unit/main/storage-*.test.ts` using `useTempDatabase`.

## Repos (8 — the only SQLite accessors)

`profiles`, `groups`, `secrets` (blob in/out for `SecretVault` — never plaintext),
`history`, `workspace`, `settings`, `saved` (folders + items, max depth
`MAX_SAVED_FOLDER_DEPTH = 32`), `audit` (retention via `audit: { retentionDays,
maxEntries }` in `ApplicationSettings`, default 50 000 entries). Unit tests own a fresh
`case-<n>.db` per test (`docs/testing.md`).
