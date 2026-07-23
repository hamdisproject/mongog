# Phase 2 — Query IDE UI report

Status: **COMPLETE and verified** (2026-07-23)

Phase 2 turns the Phase 0 execution engine and Phase 1 connection foundation
into an interactive query IDE. Database work and user-script execution remain
outside the renderer.

## Delivered

- Monaco query tabs execute the current selection or the complete document
  (`Cmd/Ctrl+Enter`) and preserve editor-relative source ranges.
- Query and Trusted modes are selectable. Trusted mode requires explicit,
  honest consent that it is equivalent to trusted local code and is not a
  security sandbox.
- Each run has a renderer-generated correlation token plus the engine
  execution ID. Events that arrive before the execute IPC response are kept;
  stale events from older runs are rejected.
- Statement lifecycle, results, console output, errors, skipped statements,
  duration, cancellation, and runtime failures are represented as structured
  Zustand state rather than text logs.
- Engine errors are shown both in the results panel and as Monaco markers at
  the original editor line/column, including selection offsets.
- Results render scalars, commands, writes, opaque values, errors, console
  entries, and cursor-backed documents as data-only React output.
- Document results use TanStack Table + TanStack Virtual, dynamic columns,
  BSON-aware canonical/relaxed EJSON rendering, row details, and bounded
  cursor pages.
- Cursor navigation supports next, previous retained page, explicit close,
  idle expiry, tab/connection owner cleanup, and correct forward navigation
  after going back (no skipped page).
- Oversized documents stay on the runtime side. The normal event contains a
  256 KB preview; an opaque, per-cursor handle can explicitly fetch a retained
  full EJSON value within a 64 MB LRU budget.
- Cancellation first asks the engine cooperatively. A runtime that cannot
  acknowledge within 750 ms is force-killed for that connection, which also
  covers synchronous infinite loops.
- Query tabs, editor contents, active tab, connection, database, and mode are
  restored through the Phase 1 workspace repository. Live results and cursor
  handles are deliberately transient.

## Security and architecture checks

- Only the official `mongodb` driver is used; real driver objects are injected
  into the utility-process VM.
- The renderer never receives a live MongoDB client, database, collection, or
  cursor.
- User cursors are paged with `cursor.next()` and are never automatically
  materialized with `toArray()`.
- Every new renderer IPC method is explicit, typed, sender-checked, and
  zod-validated in main.
- Full-value identifiers and cursor identifiers are opaque UUIDs. Full values
  are released with the retained page, cursor, tab owner, connection runtime,
  or LRU eviction.
- Database values are rendered as React data; no `innerHTML` or renderer-side
  evaluation is used.

## Verification

| Check | Result |
|---|---|
| TypeScript strict check | PASS |
| Unit tests | 140 / 140 PASS |
| Real-mongod integration tests | 25 / 25 PASS |
| Query runtime production bundle | PASS |
| Electron Forge arm64 package | PASS |
| Packaged app smoke (storage/runtime) | PASS |
| Real-mongod execution/cursor integration | PASS |

The next product phase is Phase 3: collection browsing and document editing.
Schema-aware completion remains Phase 4; indexes, explain, global search,
change streams, and GridFS remain Phase 5.
