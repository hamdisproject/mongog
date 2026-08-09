# MongoG

Production-grade, cross-platform MongoDB desktop IDE.
**Status: Phase 5.5 complete; Phase 6 is next.** See
[docs/phase5.5-report.md](docs/phase5.5-report.md),
[docs/phase5-report.md](docs/phase5-report.md),
[docs/phase4-report.md](docs/phase4-report.md),
[docs/phase3-report.md](docs/phase3-report.md),
[docs/phase2-report.md](docs/phase2-report.md),
[docs/phase1-report.md](docs/phase1-report.md), and the
[Phase 0 spike report](docs/spikes/phase0-report.md).

## Stack (ratified ADRs in `docs/adr/`)

Electron 43 · Forge 7.11 + Vite 7 (experimental plugin — ADR-0001) · React 19 ·
TypeScript strict ~5.9 · official `mongodb` driver 7.5 (real driver objects in
the script sandbox — no Mongoose, no per-method IPC) · Monaco 0.56 ·
better-sqlite3 · zod 4 · Zustand · TanStack Table/Virtual · Vitest ·
mongodb-memory-server · Playwright `_electron`.

## Architecture in one paragraph

Sandboxed renderer (React + Monaco) ↔ minimal typed preload (`contextBridge`)
↔ main process (zod-validated allowlisted IPC, SQLite, safeStorage vault,
runtime supervisor) ↔ **one `utilityProcess` query runtime per active
connection** holding the real `MongoClient` and executing user scripts in a
`node:vm` context. Statements are split/instrumented with the TypeScript
Compiler API (never semicolons); results stream as canonical-EJSON envelopes;
cursors stay runtime-side behind handle-based paging.

## Develop

```bash
npm install
node scripts/extract-mongo-types.mjs   # driver type manifest (auto via prestart)
npm run build:runtime                  # query runtime bundle (auto via prestart)
npm start                              # dev app (Forge + Vite HMR)

MONGOG_SMOKE=1 MONGOG_SPIKE_MONGO=1 npm start   # headless end-to-end smoke
npm run spike:monaco-types                      # S6: completions latency check
npm run spike:safestorage                       # S10: safeStorage async check
```

Prereqs: Node ≥ 20.19 (≥ 22.12 recommended — Electron 43 tooling), macOS/
Windows/Linux. If `electron-forge start` fails with `Could not check npm
version "undefined"` (known Forge env quirk), run once:
`touch ~/.skip-forge-system-check` (Forge's own escape hatch).

## Test

```bash
npm test            # unit (200)
npm run test:integ  # integration against real mongod (38) — first run downloads mongod
npm run test:e2e    # packaged Electron Welcome/Connections/Collection lifecycle (1)
npm run test:all
npm run typecheck
```

## Package

```bash
npm run package     # → out/MongoG-<platform>-<arch>/ (asar + fuses + unpacked runtime)
npm run make        # installers (zip/dmg on macOS)
npm run verify:icons       # validates .icon renditions and legacy .icns sizes
npm run package:mac:legacy # macOS 12–25 build path; skips Icon Composer/actool
```

The default macOS package uses `assets/mongog-icon.icon` for adaptive Default,
Dark, Clear, and Tinted Liquid Glass appearances and keeps
`assets/mongog-icon.icns` as its macOS 12–25 fallback. Building the adaptive
asset catalog requires macOS 26 and Xcode/actool 26; the explicit legacy command
uses only the ICNS copy under `assets/legacy/`.

Packaged-app self-check:
`MONGOG_SMOKE=1 out/MongoG-darwin-arm64/MongoG.app/Contents/MacOS/MongoG`.
For its DB path, start mongod externally and also set
`MONGOG_SMOKE_MONGO_URI`; packaged builds never launch
`mongodb-memory-server`.

## Layout

```
src/main        Electron main: window, IPC registry, supervisor, vault, smoke
src/preload     contextBridge typed facade (CJS, sandboxed)
src/renderer    React IDE shell, Welcome/Connections, Explorer, hybrid collection/query and admin workspaces
src/query-runtime  engine, cursor/stream registry, collection/admin operations
src/features/script-analysis  TS-AST parse/instrument/context (pure, tested)
src/shared      domain types, zod IPC schemas, errors, redaction, EJSON
scripts/        type extraction, spike checks
tests/          unit + integration + packaged Electron E2E
docs/adr        13 architecture decision records
docs/spikes     phase 0 verification report
```

## Security notes (Phase 0 defaults)

contextIsolation+sandbox+no nodeIntegration · allowlisted zod-validated IPC ·
renderer assets served only from the bounded `mongog://bundle` protocol ·
no remote content · secrets only via safeStorage async API · redacted URIs
everywhere · production fuses configured (RunAsNode off — utilityProcess
unaffected, ASAR integrity on; NodeCliInspect kept ON for test builds only).
