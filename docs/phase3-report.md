# Phase 3 — Collection browser and document editor

Status: **COMPLETE and verified** (2026-08-07)

Phase 3 adds bounded collection browsing and BSON-safe document mutations on
top of the Phase 2 runtime. Database operations stay in the per-connection
utility process; the renderer receives only typed EJSON payloads and opaque
cursor/full-value handles.

## Delivered

- Explorer collection nodes open persistent collection tabs.
- Collection reads use dedicated, zod-validated IPC and runtime operations.
  The renderer does not build or execute MongoDB driver scripts for browser
  operations.
- Filters, sort documents, and projections accept Extended JSON and are parsed
  in the runtime. Invalid or non-object input fails with a structured
  `Validation` error.
- Results use the cursor registry without `toArray()`. Next/previous paging,
  configurable page sizes, retained-page navigation, refresh cleanup, and tab
  owner cleanup are supported without imposing a one-page query limit.
- Oversized documents are opened explicitly through their opaque full-value
  handle; normal collection pages remain bounded.
- Documents can be inserted, replaced, and deleted through explicit typed
  preload methods. The editor uses canonical Extended JSON so ObjectId, Long,
  Decimal128, dates, binary data, and other BSON values round-trip losslessly.
- `_id` is mandatory and immutable during replacement.
- Replace and delete use an atomic optimistic filter containing both identity
  and the exact loaded document. Concurrent changes fail as `StaleDocument`
  instead of being overwritten; missing targets fail as `NotFound`.
- Read-only connection profiles are enforced in main before mutation requests
  reach the runtime. The renderer also disables mutation controls.
- Projected documents cannot be edited, preventing accidental replacement with
  an incomplete document.
- Delete requires explicit user confirmation. Errors remain dismissible in the
  browser instead of replacing all recovery controls.
- Successful mutations invalidate the collection schema cache before refresh.

## Security and architecture checks

- Only the official `mongodb` driver is used in the utility process.
- No live client, collection, document cursor, or BSON driver object crosses
  into the renderer.
- Every Phase 3 IPC payload is explicit, typed, sender-checked, and
  zod-validated in main.
- Cursor and full-value identifiers remain opaque and owner-scoped.
- Database values are rendered as React data; no `innerHTML` or evaluation is
  used.
- Document mutations fail closed for read-only profiles and stale documents.

## Verification

| Check | Result |
|---|---|
| TypeScript strict check | PASS |
| Unit tests | 143 / 143 PASS |
| Real-mongod integration tests | 31 / 31 PASS |
| Phase 3 CRUD/cursor integration tests | 6 / 6 PASS |
| Query runtime production bundle | PASS |
| Electron Forge arm64 package | PASS |
| Packaged app runtime/storage smoke | PASS |

Phase 4 schema-aware completion is now complete; see `docs/phase4-report.md`.
