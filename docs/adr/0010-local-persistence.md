# ADR-0010: Local persistence — SQLite (better-sqlite3) in the main process

- Status: Accepted (dependency installed; load-test in packaged app is Phase 1's first acceptance check)
- Context: Profiles, groups, workspaces/tabs, history (100k+ rows), scripts, settings, metadata cache; secrets separate.
- Options: SQLite (better-sqlite3), structured JSON files, electron-store, `node:sqlite`.
- Decision: **better-sqlite3 in main**: WAL mode, `user_version` migrations, transactional writes, indexed history queries, secrets in a separate table holding only encrypted blobs. `node:sqlite` rejected (experimental flag status in the bundled Node line); electron-store/JSON rejected (no queries/transactions, corruption-prone at history scale). Backups: versioned copy on migration + 7 rolling daily copies; corruption → dump-and-rebuild with user prompt. Native rebuild handled by Forge (`@electron/rebuild` + auto-unpack-natives) — verified during packaging spike ("Preparing native dependencies").
- Consequences: a `StorageDriver` interface keeps repositories swappable.
- Risks: native packaging on win/linux (only macOS arm64 verified in Phase 0). Revisit: if native rebuild blocks a platform → wasm sqlite behind the same interface.
