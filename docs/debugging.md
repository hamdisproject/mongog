# Debugging runbook (symptom → fix → verify)

Consolidates `AGENTS.md` landmines + `docs/bugs/BUG-001` … `BUG-005`.
General pre-push checklist: `npm run typecheck` AND `npm run lint`
(`eslint src tests`). Unit-only change still needs `npm run test:unit:<area>`.

## 1. Unit tests segfault / `NODE_MODULE_VERSION` mismatch (BUG-002)

- Symptom: `NODE_MODULE_VERSION 148 vs 115`, segfault in vitest, or dev start
  fails right after `npm install` / Forge rebuild (better-sqlite3 was rebuilt
  for Electron's Node ABI, vitest runs under system Node).
- Fix: `npm rebuild better-sqlite3` (alias: `npm run test:prepare:node` — every
  `test:unit:*` script already runs it; run it manually after any install).
- Verify: `npm run test:unit:shared` passes.

## 2. Stale/wrong completions, missing driver methods (BUG-004)

- Symptom: new `mongodb` driver API missing in Monaco, or completions lag after
  a driver bump / skipped `prestart`.
- Fix: `node scripts/extract-mongo-types.mjs` (regenerates
  `src/renderer/generated/`), then restart dev (`prestart` runs it + runtime
  build automatically). Latency check: `npm run spike:monaco-types`
  (budgets: first completion < 3000 ms cold, < 300 ms warm).
- Verify: completion for the new method appears; `npm run typecheck` clean
  (`pretypecheck` re-runs extraction).

## 3. `CursorNotFound` / empty pages / surprise eviction (BUG-005)

- Symptom: `No previous page retained`, `full document value is no longer
  retained`, cursor dies after ~10 min idle, or `Maximum active runtimes (10)
  reached` on connect.
- Fix: this is retention working as designed (`docs/runtime-lifecycle.md`) —
  **re-run the query** for a fresh handle; disconnect an idle connection at cap;
  check `beginActivity` coverage for long jobs. Do NOT raise a single TTL without
  reviewing all four (runtime idle 60 min / cursor idle 10 min / 20 pages /
  64 MB LRU).
- Verify: fresh run pages normally; `supervisor.size` ≤ 10.

## 4. Vault locked / credentialed profile won't connect (BUG-003)

- Symptom: `needsReauth`, safeStorage unavailable, macOS ad-hoc-sign or Linux
  `basic_text` backend warning; credentialed profiles blocked.
- Fix: fail-closed is intentional — never bypass with plaintext. On macOS use a
  signed build (keychain access); on Linux ensure a secret backend (GNOME
  Keyring/KWallet) or re-enter credentials when a backend appears. Check
  `npm run spike:safestorage` for backend status.
- Verify: `SecretVault` status `available`; profile connects after re-auth.

## 5. Forge `Could not check npm version "undefined"`

- Symptom: `electron-forge start` fails with the npm-version quirk (known Forge
  env issue, not our code).
- Fix (Forge's own escape hatch, once): `touch ~/.skip-forge-system-check`.
- Verify: `npm start` boots.

## 6. Smoke matrix (`MONGOG_SMOKE*`)

| Goal | Command |
|---|---|
| Dev headless end-to-end | `MONGOG_SMOKE=1 MONGOG_SPIKE_MONGO=1 npm start` (spins `mongodb-memory-server`; **dev only**) |
| Packaged self-check | start mongod externally, then `MONGOG_SMOKE=1 MONGOG_SMOKE_MONGO_URI=<uri> out/…/MongoG` |
| Packaged verify + smoke scripts | `npm run verify:package -- --platform darwin --arch arm64`, `npm run smoke:packaged -- …` |

Never start `mongodb-memory-server` from a packaged binary (`RunAsNode` fused
off — the killer helper would fork `process.execPath`). Packaged builds throw
on `MONGOG_SPIKE_MONGO=1` by design (`src/main/main.ts:60-64`).

## 7. E2E needs a binary

- Symptom: `npm run test:e2e*` finds no app.
- Fix: `npm run package` first (output in `out/`), or set
  `MONGOG_E2E_EXECUTABLE` explicitly. Teardown order is always Electron →
  database → temp files; relaunches reuse the test's own user-data dir
  (`MongoGTestContext`: `launch`/`relaunch`/`close`).
