# Contributing to MongoG

Branch → change → verify → PR. CI (`/.github/workflows/quality.yml`) gates
every PR and `main` push with typecheck, lint, sharded unit + integration
matrices, one packaged Linux build, and six parallel E2E areas — match it
locally before pushing.

## Setup

```bash
npm install
npm rebuild better-sqlite3     # required after every install (Node ABI for vitest)
npm start                      # prestart regenerates types + runtime bundle automatically
```

Prereqs: Node ≥ 22.13. If Forge fails with
`Could not check npm version "undefined"`: `touch ~/.skip-forge-system-check`
(Forge's own flag — `docs/debugging.md` §5).

## Workflow

1. Branch from `main` (`feat/<slug>`, `fix/<slug>`). One concern per PR.
2. Read `AGENTS.md` first, then the doc for your area:
   `docs/architecture.md` (routing) · `docs/ipc-howto.md` (IPC) ·
   `docs/security-model.md` (secrets/policy) · `docs/runtime-lifecycle.md`
   (supervisor/cursors) · `docs/testing.md` (which test layer) ·
   `docs/packaging.md` (packaged-app changes) · `docs/debugging.md` (stuck?).
3. Change code + tests together (see below). Keep `tests/**/*.ts` files under
   400 non-comment, non-blank lines — split helpers by behavior.
4. Verify (all must pass):
   ```bash
   npm run typecheck && npm run lint
   npm run test:unit:<area>     # affected area(s): main|runtime|renderer|analysis|shared|release
   npm run test:integ:<area>    # if engine|collections|data|admin behavior changed
   ```
5. Push, open a PR against `main`, describe: what changed, which areas ran
   (commands + result), and any secret/IPC/cursor implications. Releases go
   through version tags only (`docs/RELEASE.md`) — never from a branch push.

## Code rules (non-negotiable, from `AGENTS.md`)

- Official `mongodb` driver only — never Mongoose, never a hand-kept method list.
- No DB code or user scripts in the renderer. No `innerHTML`/`eval`
  (ESLint enforces `no-eval`/`no-implied-eval`/`no-new-func`).
- Statement splitting only via `src/features/script-analysis`; paging only via
  `cursor.next()` registry handles (never `toArray()`).
- No secrets in SQLite/logs/history/renderer/IPC — use `src/shared/redaction`.
- Preload: explicit typed methods only; every IPC payload zod-validated with a
  sender-frame check (`docs/ipc-howto.md`).
- Engine behavior change ⇒ BOTH a unit test (fakes) AND an integration test
  (real mongod). Transactions/change streams use the replica-set URI.

## Commit messages

- Preferred format: `<area>: <imperative summary>` (`engine:`, `ipc:`, `ui:`,
  `packaging:`, `docs:`, `release: vX.Y.Z` for releases — matches dominant
  history, not enforced by CI).
- Keep commits reviewable; don't mix refactors with behavior changes. No
  force-push to `main`, no empty commits, no committed secrets (report
  immediately per `SECURITY.md` if one slips in).
