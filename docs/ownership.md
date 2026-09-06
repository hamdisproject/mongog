# Ownership (review routing — human convention, not a GitHub ruleset)

Deliberately NOT named `CODEOWNERS`: this file contains no `@user` rules, and a
`CODEOWNERS`-named file with no valid rules would imply enforcement that does
not exist. If GitHub code-owner enforcement is ever wanted, add real
`<pattern> @owner` lines in `.github/CODEOWNERS` separately.


- `src/main/security/*` `src/shared/redaction/*` → security review required (vault, redaction, fail-closed)
- `src/query-runtime/engine/*` `src/features/script-analysis/*` → engine review required (policy, sandbox, auto-await) + BOTH unit and integration tests
- `src/main/ipc/*` `src/shared/ipc/*` `src/preload/*` → IPC review required (zod + sender check + preload surface)
- `src/main/runtime/*` `src/query-runtime/registry/*` → lifecycle review required (TTL/cap numbers in `docs/runtime-lifecycle.md`)
- `src/renderer/monaco/*` `scripts/extract-mongo-types.mjs` → completions review required (manifest regen)
- `forge.config.mts` `scripts/verify-packaged-app.mjs` `scripts/*release*` `scripts/*manifests*` `.github/workflows/release.yml` → packaging review required (never weaken checks)
- `src/main/storage/*` → storage review required (append-only migrations, redacted backfills)
