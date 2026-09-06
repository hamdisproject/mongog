# BUG-005 — Runtime cap (10) + cursor idle TTL (10m) cause surprise evictions

- **ID:** BUG-005
- **Status:** active
- **Priority:** medium
- **Area:** main / runtime-supervisor + query-runtime / cursor-registry + UX
- **Found:** 2026-09-06 (code inspection)

## Evidence

- `src/main/runtime/supervisor.ts:46,98-104` — `maxRuntimes: 10`; `ensureDirect` throws `Maximum active runtimes (10) reached. Disconnect a connection first.` with hint `Raise execution.maxRuntimes`.
- `src/main/runtime/supervisor.ts:63-67,280-293,338-345` — sweeper every 60s, `shouldEvictIdleRuntime` only when `idleTimeoutMS > 0 && !busy && now-lastUsedAt >= idleTimeoutMS`.
- `src/query-runtime/registry/cursors.ts:91-96,431-446` — `idleTimeoutMS: 10min`, `maxRetainedPages: 20`, `maxFullValueBytes: 64MB LRU`, sweeper 30s; `closeIdle` closes cursors AND change streams.
- `src/query-runtime/registry/cursors.ts:454-463,326-355` — expired `getOpen` throws `CursorNotFound (... re-run the query)`; `snapshotCurrentPage` FAILS on retained-truncated-without-full-value instead of silent truncated export (correct but surprising).
- `src/main/runtime/supervisor.ts:274-307` — change-stream/export/data-job activities guard against idle eviction via `beginActivity`; plain paged cursors do NOT extend runtime `lastUsedAt` unless a request settles (`request-settled` → `touch`).

## Description

Two independent TTLs interact:

1. Leave a result tab idle >10m without paging → cursor closed server-side + registry entry deleted → next `fetchNext`/`fetchPrev`/export fails, must re-run. If data changed, re-run pagination is inconsistent.
2. Leave a connection idle past `idleTimeoutMS` (default 15m) with no busy activity → whole `utilityProcess` disposed → ALL its cursors gone + reconnect required.
3. Open an 11th connection → hard error; user must discover `execution.maxRuntimes` setting.

Per-cursor memory is bounded (20 pages + 64MB LRU full-values) but there is no global cap across cursors × connections, so raising `maxRuntimes` increases utilityProcess memory pressure.

## Impact

- UX surprise during long analysis sessions; export failures on stale tabs; 11th-connection hard block.
- No data corruption (fail-closed re-run), but workflow interruption.

## Expected

Eviction is predictable: user warned before expiry, or background heartbeat keeps visible tabs alive; cap error guides to the setting.

## Suggested fix

1. Renderer: when active tab owns a cursor, heartbeat `touch`/light `hasNext` (or at least show `Cursor expires in N min` + `Refresh` action using existing `CursorNotFound` hint).
2. `supervisor.ensureDirect` error already hints at `execution.maxRuntimes` — also surface it as a toast with one-click `Disconnect idle` shortcut.
3. Document the three numbers together (supervisor idle, cursor idle, retained window) in `README.md` or settings UI; consider per-connection `lastUsedAt` update on `fetchNext` (already via `request-settled`, verify for cursor-only paging path).
4. Tests: unit `shouldEvictIdleRuntime` busy-guard matrix + `closeIdle` owner cleanup; E2E idle-tab re-run flow.

## Related

- `docs/adr/0004-query-runtime-topology.md`, `docs/adr/0009-cursor-handling.md`
- `src/shared/domain/workspace.ts` (`DEFAULT_CONNECTION_IDLE_TIMEOUT_MS`)
