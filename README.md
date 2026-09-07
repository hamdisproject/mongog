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

## Query scripts

Database calls wait automatically in both Query and Trusted Script modes:

```js
const users = db.collection("users");
const user = users.findOne({ name: "Ada" });
print(user?.name);
```

Use `Promise.all([...])` for parallel work and `for...of` for cursor iteration.
Explicit `await` remains supported. See [Query scripts](docs/query-scripts.md)
for callbacks, transactions, synchronous boundaries and cancellation.

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

Prereqs: Node ≥ 22.13 (Electron 43 tooling), macOS/
Windows/Linux. If `electron-forge start` fails with `Could not check npm
version "undefined"` (known Forge env quirk), run once:
`touch ~/.skip-forge-system-check` (Forge's own escape hatch).

## Test

```bash
npm test            # all unit areas; repairs better-sqlite3 for the current Node ABI
npm run test:integ  # all integration areas; first run downloads real mongod binaries
npm run test:e2e    # all packaged Electron E2E areas
npm run test:all    # unit → integration → Electron package → complete E2E (expensive)
npm run typecheck
```

Each layer also has independently runnable area commands:

```bash
npm run test:unit:main       # also runtime, renderer, analysis, shared, release
npm run test:integ:engine    # also collections, data, admin
npm run test:e2e:app         # also connections, query, collections, workflows, updates
```

Integration processes are created once by Vitest global setup, while each
suite owns a unique database and only cleans up its own clients/databases. E2E
uses one replica set per Playwright worker and a unique database plus temporary
Electron user-data directory per test. Relaunches inside a test intentionally
reuse that test's directory; teardown always closes Electron before dropping
the database and removing temporary files. E2E commands require an existing
package in `out/`, or an explicit `MONGOG_E2E_EXECUTABLE`.

## Package

```bash
npm run package     # → out/MongoG-<platform>-<arch>/ (asar + fuses + unpacked runtime)
npm run make        # host installers: macOS DMG/ZIP and Linux RPM
npm run make:windows:nsis # unsigned Windows x64 NSIS release (Windows; website delivery)
npm run verify:package -- --platform darwin --arch arm64
npm run smoke:packaged -- --platform darwin --arch arm64
npm run build:icons        # builds compact macOS ICNS and multi-resolution Windows ICO
npm run verify:icons       # validates optical bounds, image tiers, and icon containers
npm run package:mac:legacy # compatibility alias for the default compact macOS package
```

The default macOS package uses `assets/mongog-icon.icns` on macOS 12 and later.
Its 1024 px master keeps the visible icon inside a centered 824 px optical
envelope, matching the compact footprint of standard macOS application icons.
The Icon Composer `.icon` sources remain in `assets/` as design archives but are
not shipped or used by Finder and Dock.

Windows packages use `assets/windows/mongog-icon.ico`, which contains native
16–256 px DPI representations built from the full-canvas visual. Windows adds
its own taskbar padding, so these layers intentionally do not inherit the
compact macOS envelope. The installer, uninstaller, executable, and application
window share the same multi-resolution ICO.

Packaged-app self-check:
`MONGOG_SMOKE=1 out/MongoG-darwin-arm64/MongoG.app/Contents/MacOS/MongoG`.
For its DB path, start mongod externally and also set
`MONGOG_SMOKE_MONGO_URI`; packaged builds never launch
`mongodb-memory-server`.

## GitHub Actions releases

Kısa yayın kontrol listesi: [docs/RELEASE.md](docs/RELEASE.md)

GitHub Actions creates releases only for a version tag matching `package.json`,
for example `v1.0.0`, or from a manual workflow run that selects an existing
tag. Branch and pull-request pushes do not start this workflow. The separate
`quality.yml` workflow gates pull requests and `main` pushes with typecheck,
lint, area-based unit and integration matrices, and six parallel packaged Linux
E2E jobs. It builds the unsigned Linux test package once and transfers it as a
tar artifact so executable permissions and symlinks survive. The tag-based
release workflow remains focused on release tooling: integration, packaged
E2E, and smoke tests are intentionally excluded there. Each release platform
package is built once and shared with the final release job through artifacts.

The workflow uses GitHub-hosted Node.js 22.13.0 and Python 3.12.10 x64 on
Windows. npm, Electron, and electron-builder download caches are scoped by
platform and architecture; native `node_modules` are never shared between
runners.

macOS release artifacts are signed with Apple Developer ID, notarized by Apple,
and stapled before upload. Windows publishes an explicitly `UNSIGNED` x64 NSIS
installer; Windows may show a SmartScreen or Unknown Publisher warning. Windows
updates use HTTPS and SHA-512 verification but do not have Authenticode publisher
verification. Linux publishes only the x64 RPM. Production Electron fuses remain
hardened on every platform.

Create a protected GitHub environment named `release` and add the Apple secrets
documented in [docs/RELEASE.md](docs/RELEASE.md). `MONGOG_SIGN_RELEASE=1`
enables the fail-closed macOS signing/notarization path;
`MONGOG_RELEASE=1` controls production hardening on every platform.

Release sequence:

```bash
npm version 1.0.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: v1.0.0"
git tag v1.0.0
git push origin main v1.0.0
```

The final job assembles the six official packages, verifies the complete set,
writes `SHA256SUMS.txt`, and generates `latest-mac.yml`, `latest.yml`, and
`latest-linux.yml` from the packages' actual SHA-512 hashes. It then creates a
draft GitHub Release and uploads all packages and metadata. A manual run from
the **Actions → Release → Run workflow** screen can rebuild an existing draft
tag; published release assets are never replaced automatically.

The app uses `electron-updater` with a generic provider pointed at
`MONGOG_UPDATE_FEED_URL` (default `https://mongog.com/update`). macOS and
RPM-based Linux read `/update/latest-mac.yml` or `/update/latest-linux.yml` and
prompt before downloading. Windows reads `/update/latest.yml` only to detect a
new version, then directs the user to `https://mongog.com/releases`; it never
downloads or installs the package in-app. `/api/latest-version` remains reserved for the website UI. A
release is publishable only after the six official artifacts and all three
generated manifests from `Assemble draft release` are deployed together: two macOS
DMGs, two macOS ZIPs, one explicitly unsigned Windows NSIS EXE and one Linux RPM.

## Layout

```
src/main        Electron main: window, IPC registry, supervisor, vault, smoke
src/preload     contextBridge typed facade (CJS, sandboxed)
src/renderer    React IDE shell, Welcome/Connections, Explorer, hybrid collection/query and admin workspaces
src/query-runtime  engine, cursor/stream registry, collection/admin operations
src/features/script-analysis  TS-AST parse/instrument/context (pure, tested)
src/shared      domain types, zod IPC schemas, errors, redaction, EJSON
scripts/        type extraction, spike checks
tests/          area-based unit + integration + isolated packaged Electron E2E
docs/adr        13 architecture decision records
docs/spikes     phase 0 verification report
```

## AI contributor docs (P0)

`CLAUDE.md` (shim → `AGENTS.md`) · `docs/architecture.md` ·
`docs/ipc-howto.md` · `docs/security-model.md` + `SECURITY.md` ·
`docs/runtime-lifecycle.md` · `docs/debugging.md` · `docs/testing.md` ·
`docs/packaging.md` · `docs/storage.md` · `docs/data-transfer.md` ·
`scripts/README.md` — read the relevant file
before changing its area. Workflow: `CONTRIBUTING.md`.

## Security notes (Phase 0 defaults)

contextIsolation+sandbox+no nodeIntegration · allowlisted zod-validated IPC ·
renderer assets served only from the bounded `mongog://bundle` protocol ·
no remote content · secrets only via safeStorage async API · redacted URIs
everywhere · production fuses configured (RunAsNode off — utilityProcess
unaffected, ASAR integrity on; NodeCliInspect kept ON for test builds only).
