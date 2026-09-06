# BUG-002 — better-sqlite3 native ABI mismatch breaks unit tests / dev start

- **ID:** BUG-002
- **Status:** active
- **Priority:** medium
- **Area:** build / local persistence / test infra
- **Found:** 2026-09-06 (code inspection + AGENTS.md landmine)

## Evidence

- `src/main/storage/database.ts:1-2,48-70` — direct `better-sqlite3` import, `Database.open` with WAL/`foreign_keys`/`busy_timeout`.
- `package.json:44` — `test:unit` runs `test:prepare:node` (`npm rebuild better-sqlite3`) first; `AGENTS.md` landmine 1 documents `NODE_MODULE_VERSION 148 vs 115` segfault.
- `vite.main.config.mts` / `forge.config.mts` — `better-sqlite3` external in main, rebuilt for Electron ABI by Forge; Vitest runs under system Node ABI.

## Description

The native `.node` binary is compiled for exactly one Node ABI. Forge builds it for Electron's ABI; Vitest/`tsx` run under the dev shell's Node ABI. After any `npm install`, Node upgrade, or Forge rebuild, running unit tests (or any script that opens `Database`) without `npm rebuild better-sqlite3` segfaults before any app code runs (`integrity_check`/`backup` never reached).

## Impact

- Dev-time only (no production data loss — packaged app uses the Forge-built binary + `plugin-auto-unpack-natives`).
- Cost is lost time + flaky CI if a job shares `node_modules` across ABIs or skips the rebuild step.

## Expected

`npm test` / `npm start`-adjacent flows never crash with ABI segfault; CI matrix documents per-runner rebuild.

## Suggested fix (already partially in place — harden)

1. Keep `test:prepare:node` as pre-step for ALL unit commands (already true) — do not add a unit command that skips it.
2. CI: never share `node_modules` cache between Electron-package jobs and Vitest jobs; scope caches by platform+arch+Node (RELEASE.md already notes this for releases — extend to `quality.yml` unit jobs).
3. Add a fast preflight check (e.g. `scripts/check-sqlite-abi.mjs`) that tries `require('better-sqlite3')` and prints `npm rebuild better-sqlite3` hint instead of segfaulting silently where possible.
4. Document in `README.md` Test section (one line).

## Related

- `AGENTS.md` landmine 1
- `docs/adr/0010-local-persistence.md`
