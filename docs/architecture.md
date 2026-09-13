# Architecture (AI map — read this before changing code)

Single entry point for AI agents. `AGENTS.md` states the rules; this file shows
where things run and which files to read per task. Rationale lives in
`docs/adr/0001-0013`; history lives in `docs/phase1-report.md` … `docs/phase5.5-report.md`.

## Process boundaries

```
┌─ Renderer (sandbox, no Node, no DB) ─────────────┐
│ React 19 + Zustand + Monaco 0.56                  │
│ src/renderer/components/*, stores/*, monaco/*     │
└───────────────┬───────────────────────────────────┘
                │ contextBridge only (no ipcRenderer outside preload)
┌─ Preload (CJS sandbox bridge) ───────────────────┐
│ src/preload/preload.ts → MongoGDesktopApi         │
└───────────────┬───────────────────────────────────┘
                │ Electron IPC invoke (allowlisted channels, IpcResult envelope)
┌─ Main (Node, owns SQLite, vault, supervisor) ────┐
│ src/main/ipc/registry.ts + handlers.ts            │
│ src/main/storage/*, security/*, services/*        │
│ src/main/runtime/supervisor.ts                    │
└───────────────┬───────────────────────────────────┘
                │ RuntimeClient.request() per connection
┌─ Query runtime (1 utilityProcess per connection) ┐
│ real MongoClient + node:vm user scripts           │
│ src/query-runtime/engine/*, registry/*,           │
│   collection/*, database/*, admin/*, serialize/*   │
└───────────────────────────────────────────────────┘
```

Invariants (never break):

- No DB code or user scripts in the renderer. Ever.
- No per-method IPC for driver calls — scripts get REAL driver objects in the
  `node:vm` sandbox (`docs/adr/0005-script-execution-model.md`).
- Statements are split with the TS Compiler API (`src/features/script-analysis/`),
  never semicolons.
- Cursors stay runtime-side; renderer pages with `cursor.next()` via handles.
  Never auto-`toArray()`.

Update checks are also main-only. `update-device-identity.ts` owns a random UUID
v4 stored in SQLite under `updates:device-id`; `update-service.ts` adds it to the
generic feed as `X-MongoG-Device-Id`. The identifier never crosses preload/IPC or
renderer state and is not derived from hardware.

## Request flow (query execution)

1. Renderer calls `window.mongog.<area>.<method>` (preload typed facade).
2. `registerChannel` in `src/main/ipc/registry.ts` validates sender frame, then
   zod-parses the payload against the schema in `src/shared/ipc/index.ts`.
3. Handler in `src/main/ipc/handlers.ts` resolves the connection via
   `ConnectionManager` and forwards to `RuntimeSupervisor.get()/ensure()`.
4. `RuntimeClient.request()` sends the op to the per-connection utilityProcess.
5. Engine (`src/query-runtime/engine/execute.ts`) parses/instruments with
   `src/features/script-analysis`, runs in `node:vm` (`sandbox.ts`), enforces
   `policy.ts`, serializes results to canonical-EJSON envelopes
   (`src/shared/ejson/index.ts` + `src/query-runtime/serialize/index.ts`).
6. Cursors are registered in `src/query-runtime/registry/cursors.ts`; the
   renderer receives a handle + first page, then `fetchNext`/`fetchPrev`.

SQL uses a stricter sibling path. `query.executeSql` accepts raw SQL only; main
derives `readOnly` from the profile, and the utility process performs the
authoritative translation. Renderer Web Worker translation is preview-only.
WHERE-less UPDATE/DELETE confirmation is issued by main as a 60-second,
single-use token bound to the exact query context. Contract: `docs/sql.md`.

## IPC contract — where to look (no generated catalog)

- Channel names: `IpcChannels` in `src/shared/ipc/index.ts` (~1240 lines).
- Payload schemas: `*Schema` exports next to the channels in the same file.
- Registration: `registerChannel(channel, schema, handler, validateSender)` in
  `src/main/ipc/registry.ts` — rejects unknown senders, returns
  `IpcResult<T> = { ok: true, value } | { ok: false, error: AppError }`.
- Wiring: `registerIpcHandlers(ctx, validateSender)` in
  `src/main/ipc/handlers.ts` (every channel passes the same `validateSender`).
- Sender check: `validateSender` in `src/main/main.ts:46-50` accepts only
  `allowedRendererOrigins()` (`src/main/window.ts:29-36`): the Vite dev-server
  origin in dev, `mongog://bundle` in production.
- Preload: `src/preload/preload.ts` — `invoke()` unwraps `IpcResult` (throws the
  `AppError` on `ok: false`); `subscribe()` only allows `IpcEvents` values.
- Errors: always `appError`/`serializeError` from `src/shared/errors/index.ts`;
  handlers never leak raw errors. How-to: `docs/ipc-howto.md`.

## Zustand store map (12 stores — AGENTS.md lists 2, truth is here)

| Store file | Owns | Persisted? |
|---|---|---|
| `stores/connections.ts` | profiles/groups, connection states | profiles via SQLite; transient UI selection in memory |
| `stores/workspace.ts` | tabs, run correlation, statement/results lifecycle | tab layout via SQLite workspace repo; results transient |
| `stores/editor-context.ts` | active editor's connection/database for completions | transient |
| `stores/schema-cache.ts` | per-conn/db/collection schema, 5 min TTL, invalidate on mutate/disconnect | in-memory cache only |
| `stores/settings.ts` | `ApplicationSettings` mirror | SQLite settings repo |
| `stores/saved.ts` | saved-scripts library UI | SQLite saved-library repo |
| `stores/updates.ts` | updater status mirror (`IpcEvents.updateStatus`) | transient |
| `stores/data-transfer.ts` | import/copy job UI progress | transient (jobs live in main coordinators) |
| `stores/exports.ts` | export job UI progress | transient |
| `stores/database-renames.ts` | rename job UI progress | transient |
| `stores/command-palette.ts` | palette open/query | transient |
| `stores/toasts.ts` | notifications | transient |

Rule: never store secrets, credentialed URIs, or certs in any store
(`docs/security-model.md`).

## Budgets and defaults (single source: `src/shared/domain/workspace.ts:176-200`)

| Knob | Default | Range / values | Enforced in |
|---|---|---|---|
| `connection.idleTimeoutMS` | 60 min | 15m, 30m, 60m, 2h, 4h, 8h, 0 = never | `RuntimeSupervisor` sweeper (60 s) |
| `execution.maxRuntimes` | 10 | 1–100 | `supervisor.ensureDirect` (throws, disconnect first) |
| `execution.pageSize` | 50 | 1–500 | `execute.ts` / `query-runtime/index.ts` |
| `execution.maxRetainedPages` | 20 | 1–1000 | `CursorRegistry` |
| `execution.maxPreviewBytes` | 256 KB | positive int | `serializeToEjson` per-doc preview |
| page IPC cap | 8 MB | const `DEFAULT_PAGE_BUDGET` | `serialize/index.ts` (cuts page short) |
| full-value LRU | 64 MB | const in `cursors.ts` | opaque `fullValueId` fetch |
| `execution.cursorIdleTimeoutMS` | 10 min | ≥1 s | `CursorRegistry` sweeper (30 s) |
| `execution.defaultTimeoutMS` | 30 s | 0–600 s | engine timeout + supervisor kill |

Detail: `docs/runtime-lifecycle.md`.

## Task routing (first files to read)

| Task | Read first |
|---|---|
| New IPC channel | `docs/ipc-howto.md`, then `src/shared/ipc/index.ts`, `src/main/ipc/handlers.ts`, `src/preload/preload.ts` |
| Query/engine bug | `src/query-runtime/engine/execute.ts`, `sandbox.ts`, `policy.ts`, `src/features/script-analysis/parse.ts`, `tests/integration/engine/*` |
| SQL translator/execution | `docs/sql.md`, `src/features/sql-translator/*`, `src/main/services/sql-confirmations.ts`, `src/main/ipc/handlers.ts`, `tests/{unit,integration,e2e}/*sql*` |
| Cursor/paging bug | `src/query-runtime/registry/cursors.ts`, `docs/runtime-lifecycle.md`, `docs/bugs/BUG-005-runtime-cap-cursor-ttl.md` |
| Secret/redaction bug | `docs/security-model.md`, `src/shared/redaction/index.ts`, `src/main/security/secret-vault.ts` |
| Read-only protection | `docs/security-model.md`, `src/query-runtime/engine/read-only-guard.ts`, `policy.ts`, `sandbox.ts`, `src/main/ipc/handlers.ts` |
| Completions stale | `scripts/extract-mongo-types.mjs`, `src/renderer/monaco/*`, `stores/schema-cache.ts`, `docs/bugs/BUG-004-monaco-types-fragility.md` |
| Vault locked | `docs/bugs/BUG-003-vault-fail-closed.md`, `src/main/security/secret-vault.ts`, `mac-keychain-secret-store.ts` |
| Packaged-app failure | `docs/RELEASE.md`, `scripts/verify-packaged-app.mjs`, `scripts/run-packaged-smoke.mjs`, `src/main/smoke.ts` |
| UI state bug | the store file in the table above + its component under `src/renderer/components/*` |
| Main-process service (window, vault, supervisor, storage) | `src/main/<area>/*.ts` + `tests/unit/main/*` (`useTempDatabase` where SQLite is involved) |

## ADRs and reports (link, don't duplicate)

- Build/packaging: ADR-0001 · runtime topology: ADR-0004 · execution: ADR-0005 ·
  parser: ADR-0006 · Monaco types: ADR-0007 · EJSON: ADR-0008 · cursors: ADR-0009 ·
  persistence: ADR-0010 · grid: ADR-0011 · credentials: ADR-0012 · testing: ADR-0013.
- Phase reports: `docs/phase1-report.md` … `docs/phase5.5-report.md`,
  `docs/spikes/phase0-report.md`. Query language: `docs/query-scripts.md`.
- Known risks: `docs/bugs/README.md` + `BUG-001` … `BUG-005` (never delete fixed files).
