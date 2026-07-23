# Phase 0 Spike Report — MongoG

Date: 2026-07-22
Environment: macOS arm64, Node 20.19.5 (dev shell), Electron 43.2.0 (Node 24.18.0 bundled), mongodb driver 7.5.0, bson 7.3.1, monaco-editor 0.56.0, Electron Forge 7.11.2 (+plugin-vite, experimental).

All 10 spikes executed. Result: **10/10 PASS** (2 with adjusted design, noted below).

| # | Spike | Result | Evidence |
|---|-------|--------|----------|
| S1 | Forge-Vite 4-target build + utilityProcess IPC round-trip | PASS (design-adjusted) | `MONGOG_SMOKE=1 npm start` → "runtime ping" PASS |
| S2 | utilityProcess owns real MongoClient (standalone + replset) | PASS | smoke "runtime init + MongoClient.connect"; integration tests incl. replica-set transaction |
| S3 | vm execution, real driver globals, per-statement capture | PASS | `tests/integration/engine.test.ts` (13 tests) |
| S4 | Cursor-handle paging without toArray, TTL, close | PASS | `tests/integration/cursor-paging.test.ts` (2500 docs, 50-doc pages) |
| S5 | BSON/EJSON across process boundary, all types + truncation | PASS | `tests/integration/bson-corpus.test.ts`, `tests/unit/ejson.test.ts` |
| S6 | Monaco completions from installed mongodb.d.ts | PASS | `npm run spike:monaco-types` — cold completion **34ms**, warm **8ms** |
| S7 | Dynamic collection/field suggestions from sampled schema | PASS | `tests/unit/context.test.ts` (15 context fixtures), `tests/integration/sampling.test.ts` |
| S8 | Packaged app (asar+fuses) spawns runtime and runs query | PASS | `npm run package` → packaged app SMOKE PASS; `npx @electron/fuses read` verified |
| S9 | Cancellation layers: cooperative, cursor close, timeout, kill | PASS | `tests/integration/cancellation.test.ts`; kill path = utilityProcess.kill (used by supervisor, exercised in smoke dispose) |
| S10 | safeStorage async API incl. rotation + fallback behavior | PASS | `npm run spike:safestorage` (macOS Keychain; rotation + tamper paths verified) |

Test totals: **120 automated tests green** (96 unit + 24 integration), `tsc --noEmit` clean.

## Design changes forced by the spikes (important)

1. **plugin-vite wipes `.vite/` before builds.** The query-runtime bundle must live
   outside it → `runtime-dist/query-runtime.cjs`, kept in the package via a custom
   `packagerConfig.ignore` (`/.vite` + `/runtime-dist`). A nested-build attempt
   (closeBundle hook) was rejected: Forge resolves its build promise at ITS
   closeBundle and races ahead — documented in ADR-01 consequences.
2. **plugin-vite defaults the main bundle to CJS.** With `"type": "module"`,
   `build.lib.formats: ['es']` must be set explicitly in `vite.main.config.mts`.
3. **Preload stays CJS** (sandboxed preloads cannot be ESM) → `preload.cjs`.
4. **monaco-editor 0.56 breaking changes vs older tutorials:**
   - TS language service API moved to the top-level `typescript` namespace export
     (`monaco.typescript.typescriptDefaults`), not `monaco.languages.typescript`.
   - New `exports` map: deep worker imports must be `monaco-editor/editor/editor.worker.js?worker`
     (no `esm/vs/` prefix, `.js` suffix required).
   - `min/vs/editor.main.css` is unreachable through exports — but ESM modules
     self-import their CSS anyway. **No CDN loader, everything local.**
5. **Ambient-module wrapping for driver types (ADR-07 mechanics, verified):**
   `declare module "mongodb" { … }` works ONLY in a script file — appending
   `export {}` turns it into a failing module augmentation. Node builtins
   imported by `mongodb.d.ts` (events, net, tls, stream, os, dns) must be
   embedded from `@types/node` (87 files, 2.08 MB manifest).
6. **`mongodb-connection-string-url` and `@mongodb-js/saslprep` are hard deps** —
   externalizing them breaks the packaged runtime (require from asar.unpacked
   cannot see into asar). Only peer-optional deps stay external; mongodb+bson
   are bundled INTO the runtime (11.3 MB single file, no node_modules needed).
7. **Runtime emit-closure TDZ hazard:** engine events can fire synchronously;
   the executionId must be generated before `engine.execute()` is called.
8. **Instrumentation details (validated by tests):**
   - statement text includes the trailing `;` — must be stripped before
     wrapping in a parenthesized thunk;
   - thunk form (`async () => ( expr )`) preserves semantics AND gives precise
     per-statement timing;
   - `{ a: 1 }` at statement start is a JS Block (never a result) — matching
     REPL semantics, covered by a test.
9. **Page byte budget needs a one-document lookahead buffer** — naive
   pull-then-serialize loses documents when the budget cuts mid-page.
10. **Forge system-check bug in this environment** (`Could not check npm
    version "undefined"`): resolved via Forge's own escape hatch
    `~/.skip-forge-system-check` (documented for devs in README/AGENTS).

## Measured numbers

- Runtime bundle: 11.3 MB (mongodb+bson bundled), builds in ~8 s.
- Type manifest: 87 files, 2.08 MB; cold first completion 34 ms, warm 8 ms
  (target was <300 ms p95) — ADR-07 ratified without trimming.
- Integration: 2500-doc collection paged in 50-doc pages; `hasMore` transitions
  correct; fetchPrev from retained window; TTL expiry verified at 50 ms.
- Replica-set transaction (`withTransaction`, $inc transfers) commits correctly
  through the engine.
- Cancellation: cancel between statements → remaining skipped, status
  `cancelled`; cursors opened by a cancelled execution are closed
  (registry.size 1 → 0); engine timeout cancels long runs.
- Fuses (packaged, verified via `@electron/fuses read`): RunAsNode **off**
  (utilityProcess unaffected — confirmed), NodeOptions off, CookieEncryption on,
  EmbeddedAsarIntegrity on, OnlyLoadAppFromAsar on,
  GrantFileProtocolExtraPrivileges off, NodeCliInspect **on** (test builds only;
  flip off for production per ADR-13).

## Spike gate for Phase 1

All architectural risks are retired. Phase 1 may proceed on this skeleton:
secure window/IPC/supervisor are already real; SQLite persistence
(better-sqlite3 is installed and rebuilt by Forge) and the full domain model
land next. better-sqlite3 LOAD test in the packaged app is carried into
Phase 1 as its first acceptance check (it is not yet used by any code path).
