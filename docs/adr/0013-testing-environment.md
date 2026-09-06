# ADR-0013: Testing environment — Vitest + mongodb-memory-server + Playwright _electron

- Status: Accepted
- Context: Unit + integration + E2E layers; real MongoDB behavior without Docker dependency.
- Decision:
  - **Unit:** Vitest 4 (node env; pure packages are DOM-free), split into main, query-runtime, renderer, script-analysis, shared, and release projects. Unit commands rebuild `better-sqlite3` for the invoking Node ABI before execution.
  - **Integration:** mongodb-memory-server 11 — downloads REAL mongod binaries and supports replica sets (transactions/change streams) without Docker. Vitest global setup starts standalone and replica-set processes once; every suite receives both URIs, creates a unique database, and cleans only clients/databases it owns. Testcontainers remains reserved for a future CI version/topology matrix where Docker exists.
  - **E2E:** Playwright `_electron` (experimental — accepted, pinned). One replica set is worker-scoped; `MongoGTestContext` creates a unique database and user-data directory per test. `launch()` and `relaunch()` return `{ application, page }`; teardown closes Electron, drops the database, then removes temporary files even when assertions fail. Dialog, Monaco, layout, updater, and logging helpers receive their dependencies explicitly. `EnableNodeCliInspectArguments` stays ON in dev/test builds and OFF for production releases.
  - **CI:** pull requests and `main` pushes run static checks, area-based unit/integration matrices, one unsigned Linux package build, and six single-worker Linux E2E jobs under Xvfb. Package transfer uses tar to preserve modes/symlinks. Retries are disabled; redacted logs, traces, and screenshots are retained only for failures. Tag releases do not repeat the expensive integration/E2E gate.
- Consequences: integration tests run without Docker and cache the initial mongod download. Suites can be run independently. `npm run test:all` is the authoritative but expensive local path because it packages Electron before E2E.
- Risks: `_electron` breaking on a future Electron major. Revisit: fall back to CDP-attach harness (e2e README).
