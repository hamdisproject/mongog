# ADR-0013: Testing environment — Vitest + mongodb-memory-server + Playwright _electron

- Status: Accepted (validated: 120 tests green incl. replica-set transaction)
- Context: Unit + integration + E2E layers; real MongoDB behavior without Docker dependency.
- Decision:
  - **Unit:** Vitest 4 (node env; pure packages are DOM-free).
  - **Integration:** mongodb-memory-server 11 — downloads REAL mongod binaries, supports replica sets (transactions/change streams) without Docker; Testcontainers reserved for CI version/topology matrix (7.0/8.0 × standalone/replset × auth/TLS) where Docker exists.
  - **E2E (Phase 1+):** Playwright `_electron` (experimental — accepted, pinned). Constraints honored: `EnableNodeCliInspectArguments` fuse stays ON in dev/test builds (OFF for production releases), native dialogs stubbed via `electronApp.evaluate()`.
- Consequences: integration tests run anywhere (CI without Docker); first run downloads mongod (~150 MB, cached).
- Risks: `_electron` breaking on a future Electron major. Revisit: fall back to CDP-attach harness (e2e README).
