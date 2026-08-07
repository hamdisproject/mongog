# Phase 5 — Administration tooling

Status: **COMPLETE and verified** (2026-08-08)

Phase 5 adds operational collection/database tooling without weakening the
process boundary: the renderer sends typed data requests, while the official
MongoDB driver and all database/file streaming stay in the per-connection
utility process.

## Delivered

- A persisted Administration workspace tab with connection, database, and
  collection context plus dedicated Indexes, Explain, Global Search, Change
  Streams, and GridFS views.
- Index inspection exposes keys and relevant unique, sparse, hidden, TTL, and
  partial-filter metadata as canonical EJSON. Writable connections can create
  compound/unique/sparse/hidden/TTL/partial indexes and drop non-`_id_`
  indexes; read-only profiles disable and reject mutations.
- Explain runs typed `find(...).explain(...)` operations with filter, sort,
  projection, and all three driver verbosity modes. The renderer never builds
  or evaluates a MongoDB script for this operation.
- Global Search is deliberately bounded and labelled sampled. It iterates at
  most the configured collections/documents, searches canonical EJSON, caps
  returned matches, and reports scanned counts and truncation rather than
  claiming exhaustive database coverage.
- Collection- or database-scoped change streams support an EJSON aggregation
  pipeline and full-document modes. Streams remain runtime-side behind opaque
  handles, are polled in bounded batches, and close on stop, view/tab cleanup,
  disconnect, idle expiry, or runtime shutdown.
- GridFS lists file metadata and supports native-dialog upload/download plus
  deletion. File bytes stream directly between local files and `GridFSBucket`
  in the utility process; they are never copied through renderer IPC.
- Metadata cursors and search cursors iterate with `cursor.next()` and close in
  `finally` blocks. The existing collection listing path was also changed from
  `toArray()` to explicit iteration.
- The preload surface remains explicit and typed. Every new renderer request is
  sender-checked and zod-validated in main before it reaches a runtime.

## Security and lifecycle checks

- Index and GridFS mutations are rejected in main for read-only profiles.
- Native file paths originate only from Electron open/save dialogs in main;
  renderer code receives neither source nor destination paths.
- BSON values and change events cross process boundaries only as canonical
  EJSON data envelopes and are rendered as text/data, never HTML or code.
- Global search, explain output, list sizes, polling batches, and IPC payloads
  all have explicit bounds.
- Change streams share cursor-registry owner and TTL cleanup, including tab
  closure and connection/runtime disposal.

## Verification

| Check | Result |
|---|---|
| TypeScript strict check | PASS |
| Unit tests | 162 / 162 PASS |
| Cursor registry tests | 13 / 13 PASS (includes stream polling/lifecycle) |
| Real-mongod integration tests | 37 / 37 PASS |
| Phase 5 standalone + replica-set integration tests | 4 / 4 PASS |
| Query runtime production bundle | PASS |
| Electron Forge arm64 package | PASS |
| Packaged app runtime/storage smoke | PASS |

The next product phase is Phase 6: packaging hardening, signing, distribution,
and updates.
