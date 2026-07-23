# ADR-0009: Cursor handling — runtime-side registry, handle-only over IPC

- Status: Accepted (validated by S4: 2500 docs paged; TTL; owner cleanup)
- Context: Never transmit live cursors; never auto-`toArray()` unbounded cursors; page navigation; memory discipline.
- Decision: **CursorRegistry in the query runtime** (`src/query-runtime/registry/cursors.ts`):
  - First page pulled with `cursor.next()` loop (pageSize default 50); docs serialized as they arrive; **one-document lookahead buffer** so a page byte-budget cut never drops a document.
  - `fetchNext/fetchPrev/close`; fetchPrev served from a retained page window (default 20 pages); per-entry retained-byte accounting.
  - Idle TTL (10 min) with sweeper; ownership by `{connectionId, tabId, resultId}` → bulk cleanup on tab close / disconnect / runtime restart.
  - Change streams: separate handle type, explicit close (event streaming in Phase 5).
  - On execution success cursors STAY OPEN for interactive paging; on cancel/failure the execution's cursors are closed (verified S9).
- Consequences: predictable memory; honest `CursorNotFound` errors with re-run hints; backpressure by request/response paging (renderer asks, runtime sends).
- Risks: none material. Revisit: demand for >20-page back-history → SQLite page spill.
