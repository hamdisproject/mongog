# BUG-001 — Read-only protection bypassable via computed access / aliasing

- **ID:** BUG-001
- **Status:** fixed (2026-09-07)
- **Priority:** high
- **Area:** query-runtime / security (client-side guard)
- **Found:** 2026-09-06 (code inspection)

## Evidence

- `src/query-runtime/engine/policy.ts:5-7` — header says read-only scan is `BEST-EFFORT` and `explicitly documented as bypassable (computed member access, aliasing)`.
- `src/query-runtime/engine/policy.ts:129` — `scanWriteOperations` only matches `ts.isPropertyAccessExpression(node) && WRITE_METHODS.has(node.name.text)`.
- `src/query-runtime/engine/policy.ts:144-158` — `command({insert...})` check only matches literal `PropertyAssignment` keys, no computed keys.
- `src/query-runtime/engine/execute.ts:151-167` — read-only path only runs that static scan, hint says `Use server-side roles for authoritative control`.
- `src/query-runtime/engine/sandbox.ts:167-168,184-194` — sandbox injects REAL `client`/`db` objects; trusted mode adds allowlisted `require('mongodb'|'bson')`.
- `src/main/ipc/handlers.ts:163-169` — `requireWritableConnection()` blocks CRUD IPC for read-only profiles, but script `execute` path relies on the static scan above.

## Description

`readOnly` profile flag is enforced in three places: renderer button disables, main `requireWritableConnection` for CRUD IPC, and static AST scan for scripts. The script path can be bypassed without `vm` escape:

```js
coll["insert" + "One"](doc)          // ElementAccess, not PropertyAccess
const fn = coll.deleteMany; fn({})   // aliasing
db.command({ ["inse"+"rt"]: "x", documents: [...] })
```

All three perform a write but do not match the literal-name scan.

## Impact

Accidental writes are blocked; intentional/trivially-crafted writes on a privileged Mongo user are NOT blocked. Users may believe UI `readOnly` is a security boundary. It is not (consistent with `ADR-0005`: `vm` is scope isolation, not a security boundary).

## Expected

Either (a) make client-side read-only robust with runtime enforcement, or (b) make the UI copy explicit that server roles are authoritative.

## Suggested fix

1. Add `src/query-runtime/engine/read-only-guard.ts` — recursive `Proxy` wrap for `MongoClient/Db/Collection` that blocks `WRITE_METHODS` at `get`-time (covers computed access + aliasing), inspects `command()` first-arg keys and `aggregate()` pipeline for `$out/$merge` at runtime.
2. Wire into `sandbox.ts:createSandbox` when `readOnly=true` (wrap `client`, `db`, `use()`, `getSiblingDB()`, and `require('mongodb')` result).
3. Keep static scan for early editor-range errors; runtime guard is the enforcement.
4. In `ConnectionsView`, when `readOnly=true` but `connectionStatus(showPrivileges:true)` shows write privileges, show warning + suggest `read`-role user.
5. Tests: unit (bypass strings) + integration (real mongod, read-only runtime must throw `ReadOnlyProtection`).

## Related

- `docs/adr/0005-script-execution-model.md`
- `src/shared/domain/connections.ts:47` (`ConnectionProfile.readOnly`)

## Resolution

- `src/query-runtime/engine/read-only-guard.ts` now recursively wraps real
  MongoDB driver objects and runtime-inspects commands and aggregation stages.
- `sandbox.ts` applies it to injected client/db objects, database switching and
  trusted-module-created clients. Main derives `readOnly` from the saved profile
  on every execution.
- Verified by `tests/unit/query-runtime/read-only-guard.test.ts` and real-mongod
  bypass cases in `tests/integration/engine/policy-errors.test.ts`.
- Server-side MongoDB roles remain the final authorization boundary.
