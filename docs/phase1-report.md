# Phase 1 Report — Persistence, Connections, Explorer

Date: 2026-07-23

Phase 1 is complete. The storage, connection-management, Explorer, window-state,
and packaged-native acceptance paths are implemented and verified.

## Delivered

- SQLite database with WAL, foreign keys, atomic migrations, `_migrations`
  audit rows, and SQLite `user_version` tracking.
- Repositories for groups, connection profiles, encrypted secret blobs, query
  history, workspace state, settings, and saved scripts.
- Connection group/profile CRUD through typed preload methods and
  zod-validated, sender-validated main-process IPC.
- Credentials encrypted through `SecretVault` before persistence. Profile
  creation fails closed if secure storage is unavailable; plaintext secret
  blobs are never written to SQLite.
- Runtime lifecycle events for connecting, connected, error, unexpected crash,
  intentional disconnect, and idle eviction.
- Explorer groups/profiles with persisted group collapsed state, connect /
  disconnect, database and collection expansion, and coherent cleanup when
  profiles or groups are removed.
- Window bounds and maximized-state persistence with off-screen recovery.
- Workspace tab persistence.
- Packaged application loading `better-sqlite3` from
  `app.asar.unpacked/node_modules` with Electron ABI 148.

## Correctness and security fixes made at the Phase 1 gate

1. `ConnectionManager` now uses the async safe-storage vault instead of writing
   JSON credentials directly to the secrets repository.
2. Secret writes are awaited. A profile is not inserted if encryption fails,
   and profile updates compensate the vault operation if the database update
   fails.
3. Deleting a group follows the schema's `ON DELETE SET NULL` behavior:
   profiles become ungrouped and retain their encrypted credentials.
4. Failed runtime initialization kills the utility process instead of leaking
   an untracked process.
5. Intentional runtime disposal no longer emits a false crash event.
6. Errors crossing process boundaries redact credentialed MongoDB URIs,
   including nested cause messages.
7. Forge packages production `node_modules` so external native dependencies
   resolve inside the application rather than falling back to the development
   workspace.

## Verification

- `npm run typecheck`: PASS
- `npm test`: **130/130** unit tests PASS
- `npm run test:integ`: **24/24** real-mongod integration tests PASS
- `npm run package`: PASS
- Packaged `MONGOG_SMOKE=1` check: PASS
  - utility-process runtime ping
  - packaged native SQLite load
  - database integrity and repository access
  - group/profile CRUD and URI resolution
  - window-state persistence
  - secure-storage fail-closed behavior

The locally packaged macOS app is ad-hoc signed, so macOS may deny it Keychain
encryption access. The smoke test verifies that this condition rejects secret
profile persistence without a plaintext fallback. Full signed-package Keychain
validation remains part of Phase 6 signing/release work.

## Phase 2 gate

Phase 2 may continue on this foundation. Query execution remains isolated in
the per-connection utility process; no database or user-script execution moves
into the renderer.
