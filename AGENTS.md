# AGENTS.md — MongoG

## What this is

MongoDB desktop IDE (Electron). **Phases 0–5.5 are COMPLETE and verified** — see
`docs/spikes/phase0-report.md`, `docs/phase1-report.md`,
`docs/phase2-report.md`, `docs/phase3-report.md`, `docs/phase4-report.md`, and
`docs/phase5-report.md` and `docs/phase5.5-report.md`. Phase 6 is next.
Plan ADRs: `docs/adr/0001-0013`.

## Non-negotiable rules (from the product plan)

- Official `mongodb` npm package only. Never Mongoose. Never maintain a manual
  list of driver methods — scripts get REAL driver objects in the vm sandbox.
- No DB code or user scripts in the renderer. Ever.
- No naive semicolon statement splitting — always `src/features/script-analysis`.
- No auto `toArray()` on user cursors — page with `cursor.next()` via the registry.
- No secrets (passwords, credentialed URIs, certs, tokens) in plaintext anywhere:
  not in SQLite, logs, history, renderer state, or IPC. Use `shared/redaction`.
- Preload exposes explicit typed methods only; every IPC payload is zod-validated
  in main (`src/main/ipc/registry.ts`); sender frames are validated.
- Renderer renders DB values as DATA only (no innerHTML, no eval).

## Commands

```bash
npm start            # dev (runs extract:types + build:runtime first)
npm test             # unit
npm run test:integ   # integration (real mongod via mongodb-memory-server)
npm run typecheck    # must stay clean
npm run package      # packaged app in out/
MONGOG_SMOKE=1 MONGOG_SPIKE_MONGO=1 npm start   # headless end-to-end check
```

`MONGOG_SPIKE_MONGO=1` is development-only. A packaged smoke must use an
externally started mongod through `MONGOG_SMOKE_MONGO_URI`; never start
`mongodb-memory-server` from a packaged Electron binary because its killer
helper forks `process.execPath` while production RunAsNode is fused off.

Env: Node ≥ 22.13. If Forge complains `Could not check npm
version "undefined"`: `touch ~/.skip-forge-system-check` (Forge's own skip flag).

## Architecture map (where things live)

| Area | Path | Notes |
|---|---|---|
| Main process | `src/main/main.ts` | ESM entry → `.vite/build/main.js` |
| Window/security | `src/main/window.ts` | sandbox+contextIsolation; bounded `mongog://bundle` renderer protocol; navigation lockdown |
| Window state | `src/main/window-state.ts` | persist/restore bounds + maximized |
| IPC | `src/main/ipc/` | `registry.ts` allowlist+zod; connection/query/cursor handlers |
| Runtime supervisor | `src/main/runtime/` | 1 utilityProcess per connection; idle GC; crash events |
| Services | `src/main/services/connection-manager.ts` | profiles/groups CRUD + connect/disconnect + URI resolution |
| Update service | `src/main/services/update-service.ts` | `electron-updater` wrapper (generic feed); consent-driven check/download/install; mirrors status via `IpcEvents.updateStatus` |
| Database | `src/main/storage/database.ts` | better-sqlite3 WAL; migration runner; backup; integrity |
| Migrations | `src/main/storage/migrations.ts` | v1: 7 tables + indexes |
| Repositories | `src/main/storage/repositories/` | groups, profiles, secrets (blob), history, workspace, settings, scripts |
| Secret vault | `src/main/security/secret-vault.ts` | safeStorage + SecretsRepo backing |
| Headless checks | `src/main/smoke.ts` | `MONGOG_SMOKE=1` |
| Preload | `src/preload/preload.ts` | CJS (`preload.cjs`) — sandboxed preloads can't be ESM; exposes full connections API |
| Query runtime | `src/query-runtime/` | entry `index.ts` → `runtime-dist/query-runtime.cjs` |
| Engine | `src/query-runtime/engine/` | vm sandbox, capture/classify, policy scans |
| Cursor registry | `src/query-runtime/registry/cursors.ts` | cursor/change-stream handles, paging/polling, TTL, owner cleanup |
| Admin operations | `src/query-runtime/admin/operations.ts` | indexes, explain, bounded search, change streams, GridFS streaming |
| Script analysis | `src/features/script-analysis/` | PURE: TS-AST parse/instrument/context — no io |
| Shared contracts | `src/shared/` | domain, ipc+zod, errors, redaction, ejson |
| Renderer | `src/renderer/` | React 19 + Zustand 5; Explorer + full query IDE |
| Welcome | `src/renderer/components/Welcome/WelcomeView.tsx` | startup singleton, recent connections, query shortcuts |
| Connections UI | `src/renderer/components/Connections/` | searchable master/detail; Basic/Advanced validated drafts |
| Query editor | `src/renderer/components/Editor/QueryEditor.tsx` | selection/full run, modes, cancel, Monaco errors |
| Results | `src/renderer/components/Results/ResultsPanel.tsx` | structured EJSON, virtual table, cursor controls |
| Collection workspace | `src/renderer/components/Results/CollectionView.tsx` | persistent Documents/Query switch with locked namespace context |
| Workspace store | `src/renderer/stores/workspace.ts` | run correlation, statement/results lifecycle |
| Zustand store | `src/renderer/stores/connections.ts` | connection state management |
| Explorer UI | `src/renderer/components/Sidebar/Explorer.tsx` | tree view with groups + profiles + status |
| Monaco | `src/renderer/monaco/` | local workers; `typescript` namespace API (0.56!) |
| Type manifest | `scripts/extract-mongo-types.mjs` → `src/renderer/generated/` | regenerated by prestart/prepackage |
| Schema completions | `src/renderer/monaco/completions.ts` | field + method completions; uses `editor-context` store |
| Editor context | `src/renderer/stores/editor-context.ts` | active editor's connection/database for completions |
| Schema cache | `src/renderer/stores/schema-cache.ts` | per-conn/db/col cache, TTL 5min |
| Administration UI | `src/renderer/components/Admin/AdminView.tsx` | indexes, explain, search, streams, GridFS |

## Build-system landmines (learned the hard way — read before touching configs)

1. **better-sqlite3 native ABI mismatch.** `npm install` and `electron-forge`
   rebuild it for Electron's Node ABI; `vitest` runs under the dev shell's
   Node. Fix after any package or install: `npm rebuild better-sqlite3`.
   Symptoms: `NODE_MODULE_VERSION 148` vs `115` segfault in unit tests.
2. **Main MUST be ESM**: `vite.main.config.mts` sets `build.lib.formats:['es']`
   (plugin defaults CJS; package.json is `"type":"module"`).
3. **Entries are named by file**: `src/main/main.ts` → `main.js` (matches
   package.json `main`), `src/preload/preload.ts` → `preload.cjs`
   (rollupOptions format cjs). Renaming files breaks the app silently.
4. **Runtime bundle must be self-contained**: mongodb+bson are bundled IN
   (11 MB). Only peer-optional deps are external (kerberos, snappy, zstd,
   mongodb-client-encryption, gcp-metadata, aws4, socks, os-dns-native,
   @aws-sdk/credential-providers). `mongodb-connection-string-url` and
   `@mongodb-js/saslprep` are HARD deps — never externalize.
5. **monaco-editor 0.56**: use the top-level `typescript` namespace export
   (`monaco.typescript.typescriptDefaults`); workers import as
   `monaco-editor/editor/editor.worker.js?worker` (exports map; no `esm/vs/`
   prefix, `.js` suffix); ESM self-imports CSS — do NOT import `min/vs` css.
6. **Ambient d.ts wrapping** (`scripts/extract-mongo-types.mjs`):
   `declare module "x" {…}` must be in a SCRIPT file — no trailing `export {}`.
7. `better-sqlite3` is external in main builds; Forge rebuilds natives and
   `plugin-auto-unpack-natives` unpacks `.node` files. Its packaged load-check
   remains a required smoke acceptance test.
8. `EnableNodeCliInspectArguments` fuse stays ON in test builds (Playwright),
   OFF for production release builds.
9. Production renderer assets use `mongog://bundle`, not `file://`. Register
   the privileged scheme before `app.ready`, install its bounded handler after
   ready, and keep `GrantFileProtocolExtraPrivileges` OFF.

## Testing conventions

- Unit tests never touch the network/processes; registry/policy/analysis are
  tested with fakes (`tests/unit/`).
- Integration tests use `tests/integration/helpers/mongo.ts` (standalone +
  1-node replica set). Replica-set-only features (transactions, change
  streams) go to the replset suite. First run downloads mongod binaries.
- When you change engine behavior, add BOTH a unit test (analysis/policy) and
  an integration test (real driver) where applicable.

## Phase roadmap

Phase 1 (complete): SQLite repositories + connection profiles + explorer +
window state. Phase 2 (complete): full query IDE UI. Phase 3 (complete): collection
browser/document editor. Phase 4 (complete): schema-aware completions. Phase 5
(complete): admin (indexes/explain/global search/change streams/GridFS). Phase
5.5 (complete): Welcome and Basic/Advanced connection experience. Phase 6:
packaging hardening/signing/update.
Do not jump ahead: UI polish before Phase 2 is out of scope.
