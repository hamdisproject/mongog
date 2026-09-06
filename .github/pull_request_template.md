## What changed

<!-- area: engine / ipc / ui / packaging / docs / … -->

## Verification

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] Unit: `npm run test:unit:<area>` — <result>
- [ ] Integration: `npm run test:integ:<area>` — <result / n/a + why>
- [ ] E2E / packaged smoke — <result / n/a + why>

## Risk checklist (check or explain n/a)

- [ ] No secrets in SQLite / logs / history / renderer state / IPC (`src/shared/redaction` applied)
- [ ] IPC change follows `docs/ipc-howto.md` (zod schema + sender check + preload method)
- [ ] No DB code in renderer; no `innerHTML` / `eval`
- [ ] No auto-`toArray()` on user cursors (registry paging)
- [ ] Engine change has BOTH unit + integration tests
- [ ] No `tests/**/*.ts` file exceeds 400 non-comment, non-blank lines
