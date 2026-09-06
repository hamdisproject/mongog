# Runtime + cursor lifecycle (numbers AI must not invent)

Code truth: `src/main/runtime/supervisor.ts`,
`src/query-runtime/registry/cursors.ts`,
`src/query-runtime/serialize/index.ts`, `src/shared/ejson/index.ts`,
defaults in `src/shared/domain/workspace.ts:176-200`.

## Supervisor (main process, 1 utilityProcess per connection)

- `ensure(connectionId, uri, options)`: returns the live client (`lastUsedAt`
  refreshed); dead entry is disposed first. At cap (`execution.maxRuntimes`,
  default **10**) it throws `Maximum active runtimes (10) reached` — the caller
  must disconnect a connection first (hint suggests raising the setting).
- `get(connectionId)`: live client or `null` (also refreshes `lastUsedAt`).
- `touch(connectionId)`: called on every `request-settled` event — activity
  keeps the runtime alive; idleness is measured from the last touch.
- Idle eviction: `startSweeper(60_000)` → `evictIdle()` kills runtimes idle
  longer than `connection.idleTimeoutMS` (default **60 min**; allowed
  15m/30m/60m/2h/4h/8h/0=never). `0` disables eviction for that setting.
- `dispose(id)` / `disposeAll()` (intentional disconnect/shutdown) vs
  `terminate(id, reason)` (hard-stop, emits `runtime-force-killed`).
- `restart(id, { reason, executionId, runId })`: single-flight via the
  `restarts` map — concurrent restart/ensure calls share one operation so only
  one utilityProcess is born. Reuses the in-memory URI/options.
- Crash vs goodbye: `client.on('exit')` deletes the entry and emits
  `runtime-exit` ONLY if the exiting client is still the managed one —
  `dispose()` removes the entry before killing, so intentional kills are not
  crashes. Other events: `runtime-connecting`, `runtime-ready` (with
  `{ pid, serverVersion, connectedAt }`), `runtime-connect-error`,
  `runtime-restarting`. Engine/export/data-job events are re-emitted
  (`engine-event`, `export-progress`, `data-job-progress`) while tracking
  per-execution activity contexts.
- Guard long work with `beginActivity`-style execution contexts
  (`executionContexts` map keyed by `executionId` with `tabId`/`runId`) so
  cancel/kill targets the right execution. Never hold a `RuntimeClient` across
  `dispose()` — re-`get()` it.

## CursorRegistry (inside each runtime)

- `register(cursor, owner, namespace)` → `cursorId`. Owner cleanup closes all
  of an owner's cursors/streams (tab close, disconnect).
- Paging: `fetchNext(cursorId, pageSize)` pulls up to `pageSize` docs
  (default **50**, `execution.pageSize`) via `cursor.next()` — never `toArray()`.
  A page is cut short when it would exceed `maxPageBytes` (**8 MB**,
  `DEFAULT_PAGE_BUDGET`). `fetchPrev` serves the retained window only and does
  NOT touch the live cursor.
- Retention: up to `maxRetainedPages` (**20** default) pages per cursor for
  `fetchPrev`; oversized full values retained under an LRU of **64 MB**
  (`maxFullValueBytes`) and fetched explicitly via opaque `fullValueId`.
- Idle TTL: cursors/streams untouched for `execution.cursorIdleTimeoutMS`
  (default **10 min**) are closed by the 30 s sweeper. Expired handles throw
  `CursorNotFound` (`No previous page retained` / `full document value is no
  longer retained` / `no retained current page`) — the correct recovery is
  **re-run the query**, not retry the handle.
- Export path `snapshotCurrentPage` resolves retained envelopes to BSON and
  throws `CursorNotFound`/`Validation` when retention lapsed — surface the
  re-run hint, don't silently export partial data.

## EJSON envelope (cross-process fidelity)

- Wire type: `EjsonEnvelope { ejson, byteSize, truncated, fullValueId? }`
  (`src/shared/ejson/index.ts`). `ejson` is ALWAYS canonical EJSON
  (`relaxed: false`); the renderer re-renders relaxed/canonical/mongosh
  (`ejson.defaultMode`, default `mongosh`).
- Per-doc preview cap `maxPreviewBytes` (default **256 KB**): oversized docs
  become a truncated preview + retained full value (`serializeToEjsonWithFull`).
- Non-serializable values (circular, Trusted-Mode host objects) degrade to
  `{ $mongogOpaque: "<inspect>" }` — never throw across IPC for display data.

## Eviction interaction (BUG-005 — read before tuning)

Runtime idle (default 60 min) vs cursor idle (default 10 min) vs retained pages
(20) vs full-value LRU (64 MB): a cursor can expire while its runtime lives, and
a runtime can be evicted while the UI still shows its tabs. Never "fix" surprise
evictions by raising one number — check all four plus `beginActivity` coverage
first. `docs/bugs/BUG-005-runtime-cap-cursor-ttl.md`.
