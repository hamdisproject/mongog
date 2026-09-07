# Testing cookbook (which layer, which harness, which command)

Three layers, three configs, three harnesses. Pick the layer first — the wrong
layer is the most common AI test mistake (real mongod in a unit test, Electron
launch in an integration test).

## Layer map

| Layer | Config | What it covers | Must NEVER do |
|---|---|---|---|
| Unit | `vitest.unit.config.mts` (`tests/unit/**/*.test.ts`, node env, forks pool) | pure logic with fakes: policy scan, script-analysis, cursor registry, redaction, EJSON, stores, supervisor (fake client) | network, processes, real mongod, Electron |
| Integration | `vitest.integration.config.mts` (180 s test / 240 s hook timeout) | real driver against real mongod: engine, collections, data-transfer/export, admin ops | launch Electron; assume an empty server (see isolation) |
| E2E (packaged) | `playwright.config.ts` (workers: 1, retries: 0, 90 s timeout) | packaged Electron app, one area per spec dir | module-level app state; `mongodb-memory-server` from the packaged binary |

CI (`/.github/workflows/quality.yml`): `static` (typecheck+lint) → `unit` matrix
(main, runtime, renderer, analysis, shared, release, sql) → `integration` matrix
(engine, collections, data, admin) → `e2e-package` (one unsigned Linux build,
shipped as a tar so permissions/symlinks survive) → `e2e` matrix
(app, connections, query, collections, workflows, updates) with
`MONGOG_E2E_EXECUTABLE` pointing at the unpacked build.

## Unit: area + fakes + 400-line limit

- Area commands: `npm run test:unit:<area>` where area ∈
  `main, runtime, renderer, analysis, shared, release, sql`. `npm test` runs all unit areas.
- Every `test:unit:*` script first runs `test:prepare:node`
  (`npm rebuild better-sqlite3`) — after any `npm install`, run it manually
  before vitest or you get the ABI segfault (`docs/debugging.md` §1).
- SQLite-backed code uses `useTempDatabase(prefix)` from
  `tests/unit/main/helpers/temp-database.ts`: one temp dir per file (`beforeAll`),
  one fresh `case-<n>.db` per test (`beforeEach`), recursive remove in `afterAll`.
- Connection-manager tests compose `tests/unit/main/helpers/connection-manager.ts`
  + `tests/unit/main/helpers/update-service.ts` (fake updater) — copy that trio,
  don't invent a new harness.
- Time-based logic (debounce, TTL, sweeps): `vi.useFakeTimers()` +
  `vi.advanceTimersByTime(ms)` with `vi.useRealTimers()` restore in `afterEach`
  (see `tests/unit/query-runtime/cursor-registry.test.ts`,
  `tests/unit/renderer/toasts-store.test.ts`). Never `sleep()` in unit tests.
- ESLint `max-lines` caps every `tests/**/*.ts` file at **400 non-comment,
  non-blank lines**. Split helpers by behavior (e.g.
  `tests/integration/engine/helpers/execution.ts`) instead of growing one file.

## Integration: `useMongoIntegrationSuite(scope)`

Template (`tests/integration/fixtures/mongo.ts`, setup in
`tests/integration/fixtures/global-setup.ts`):

```ts
import { useMongoIntegrationSuite } from '../fixtures/mongo.js';

const suite = useMongoIntegrationSuite('my-feature'); // unique db per suite file
// suite.standaloneUri / suite.replicaSetUri already include the unique db name
// suite.newClient(uri?) connects + tracks the client for afterAll close
// afterAll drops ONLY this suite's databases (exact name + name_ prefix)
```

Rules:

- One standalone + one 1-node replica set are created ONCE per vitest run by
  global setup (first run downloads mongod binaries — slow, cached in
  `~/.cache/mongodb-binaries` in CI). Every suite gets a unique database
  (`mongog_<scope>_<pid>_<seq>`) and cleans only its own clients/databases.
- Transactions and change streams REQUIRE `suite.replicaSetUri` (standalone has
  no oplog). Everything else defaults to `suite.standaloneUri`.
- Engine tests drive `ExecutionEngine` directly via
  `tests/integration/engine/helpers/execution.ts` (`executeAndCollect` +
  `collectEngineEvents`) with `owner: { connectionId: 'test' }` — copy it.
- Engine behavior change ⇒ BOTH a unit test (analysis/policy with fakes) AND an
  integration test (real driver). Review rejects one-sided engine PRs.
- SQL changes additionally cover strict AST acceptance/rejection in
  `tests/unit/sql-translator`, real CRUD/NULL/JOIN behavior in
  `tests/integration/engine/sql-translation.test.ts`, and the packaged worker,
  confirmation, read-only and persistence path in `tests/e2e/query/sql.spec.ts`.

## E2E: `MongoGTestContext` (`tests/e2e/fixtures/mongog-test.ts`)

```ts
import { test, expect } from '../fixtures/mongog-test.js';

test('…', async ({ mongog }) => {
  const { page } = await mongog.launch();   // unique db (seeded `inventory`) + temp user-data dir
  // … drive UI via tests/e2e/helpers/ui.ts, dialogs.ts …
  await mongog.relaunch();                  // same dir, fresh process (persistence tests)
  await mongog.close();                     // or let the fixture auto-teardown
});
```

Rules:

- One replica set per Playwright worker (worker-scoped `workerMongo`); unique
  database + temp Electron user-data dir (`MONGOG_E2E_USER_DATA`) per test.
- Requires a package in `out/` (`npm run package`) or explicit
  `MONGOG_E2E_EXECUTABLE`. In CI the tar-unpacked Linux build is used with
  `xvfb-run`. Locally: package first, then `npm run test:e2e:<area>`.
- Use `launch` / `relaunch` / `close` — never module-level app state.
- Relaunch intentionally reuses the test's dir (that's how persistence is
  tested). Teardown order is always Electron → database → temp files (the
  fixture does this; `removeElectronUserData` last). Keep it.
- Electron stdout/stderr are captured per-launch to
  `electron-<n>.log` with `redactForLog` — never log raw URIs in helpers.
- `retries: 0`: a flaky E2E test is a bug, not a retry candidate. Fix the
  timing (`expect.poll` for window size is the established pattern) instead of
  adding sleeps.

## Pre-push sequence

```bash
npm run typecheck && npm run lint
npm run test:unit:<area>        # affected area(s); ABI rebuild is automatic
npm run test:integ:<area>       # if engine/collection/data/admin behavior changed
# E2E only when touching packaged-app behavior (window, protocol, updater, flows)
```

`npm run test:all` (unit → integration → package → full E2E) is intentionally
expensive — CI runs it in sharded form; locally use it only before releases.
