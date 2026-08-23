# MongoG

Production-grade, cross-platform MongoDB desktop IDE.
**Status: Phase 5.5 complete; Phase 6 release packaging is in progress.** See
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
npm run make        # host installers: macOS DMG/ZIP, Windows Setup/ZIP, Linux DEB/RPM/ZIP
npm run verify:package -- --platform darwin --arch arm64
npm run smoke:packaged -- --platform darwin --arch arm64
npm run build:icons        # builds compact ICNS from the standard ten-image iconset
npm run verify:icons       # validates optical bounds, iconset sizes, and ICNS contents
npm run package:mac:legacy # compatibility alias for the default compact macOS package
```

The default macOS package uses `assets/mongog-icon.icns` on macOS 12 and later.
Its 1024 px master keeps the visible icon inside a centered 824 px optical
envelope, matching the compact footprint of standard macOS application icons.
The Icon Composer `.icon` sources remain in `assets/` as design archives but are
not shipped or used by Finder and Dock.

Packaged-app self-check:
`MONGOG_SMOKE=1 out/MongoG-darwin-arm64/MongoG.app/Contents/MacOS/MongoG`.
For its DB path, start mongod externally and also set
`MONGOG_SMOKE_MONGO_URI`; packaged builds never launch
`mongodb-memory-server`.

## CircleCI and GitHub releases

Kısa yayın kontrol listesi: [docs/RELEASE.md](docs/RELEASE.md)

CircleCI runs typecheck, lint, and unit/integration tests for every branch and
pull request. Pushes to `main` additionally build and verify unsigned packages
on macOS arm64/x64, Windows x64, and Linux x64. Native packaged smoke runs on
macOS arm64, Windows x64, and Linux x64; the macOS x64 package is structurally
and architecturally verified because CircleCI no longer provides Intel hosts.
Each successful `main` platform job exposes its packaged application archive
under the job's **Artifacts → packages** section in CircleCI.
Release builds are created only from a version tag matching
`package.json`, for example `v1.0.0`. Each release job stores its normalized
installer/portable archives directly in CircleCI Artifacts.

macOS release artifacts are signed with Apple Developer ID, notarized by Apple,
and stapled before upload. Windows and Linux artifacts remain unsigned and keep
the `UNSIGNED` marker; Windows SmartScreen warnings are therefore still
expected. Production Electron fuses remain hardened on every platform.

Create a restricted CircleCI context named `release`, limit it to the MongoG
project and release team, and add the Apple variables documented in
[docs/RELEASE.md](docs/RELEASE.md). `MONGOG_SIGN_RELEASE=1` enables the
fail-closed macOS signing/notarization path; `MONGOG_RELEASE=1` controls
production hardening without implicitly requiring credentials on other
platforms.

Release sequence:

```bash
npm version 1.0.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: v1.0.0"
git tag v1.0.0
git push origin main v1.0.0
```

After a platform job succeeds, download its packages from that job's
**Artifacts** tab. An existing tag can be rebuilt from CircleCI's **Trigger
Pipeline** screen by setting `run_release=true` and
`release_tag=vX.Y.Z`. Enable tag-push triggers in the CircleCI GitHub project
settings and use the CircleCI job names for required branch-protection checks.
Automatic application updates are intentionally outside this release phase.

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
