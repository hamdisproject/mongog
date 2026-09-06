# Data paths (transfer, export, rename, GridFS, search)

Bulk-data features move documents between files, connections, and databases.
Shared rules first, per-path contracts after. Code:
`src/query-runtime/{data-transfer,export,admin,collection}/*`,
`src/main/{data-transfer,database-rename,export}/*`.

## Rules for every data path

- **File paths come from main-side dialogs only.** `dialog.showOpenDialog` /
  `showSaveDialog` run in `DataTransferCoordinator` /
  `DatabaseRenameCoordinator` / export handlers (`src/main/*`). The renderer
  never constructs a filesystem path; the runtime never receives one except as
  a dialog result passed back through IPC.
- **Documents cross processes as canonical EJSON** (`relaxed: false`).
  `writeTransferBatch` rejects anything that isn't valid canonical-EJSON
  documents (`src/query-runtime/data-transfer/write.ts:37-48`).
- **GridFS bytes never ride IPC.** Upload/download stream inside the runtime
  (`pipeline(bucket.openDownloadStream(id), createWriteStream(destinationPath))`,
  `src/query-runtime/admin/operations.ts:265-267`) — IPC carries only ids and
  metadata envelopes.
- **Mutations respect read-only.** Collection/transfer/rename IPC ops go through
  `requireWritableConnection()` (`src/main/ipc/handlers.ts:163-169`); scripted
  writes are best-effort static scan (BUG-001 — `docs/security-model.md` §3).
- **Progress is evented, cancellation is explicit.** Long jobs emit
  `DataJobProgressEvent` / `ExportProgressEvent` / `DatabaseRenameProgressEvent`
  (re-emitted by the supervisor) and honor job-cancel channels. Terminal events
  release the job server-side — don't leak `ManagedJob` entries.

## Path contracts (verified numbers — don't invent others)

| Path | Bounds | Notes |
|---|---|---|
| Transfer write batch | **500 docs / 8 MiB** per batch (`TRANSFER_MAX_BATCH_DOCUMENTS/BYTES`) | `conflictMode` (`insert-stop` uses ordered `insertMany`), `rowErrorPolicy` (`stop`/`skip`), upsert key asserted usable before write |
| Collection bulk update/delete payloads | **64 MiB** (`MAX_COLLECTION_BULK_UPDATE_BYTES`, shared with delete) | checked via `bulkUpdatePayloadExceedsLimit` / `bulkDeletePayloadExceedsLimit` in `src/shared/collection-update.ts` |
| Export | formats `xlsx/csv/txt` (`EXPORT_FORMATS`), scopes `current-page/all-matching` (`EXPORT_SCOPES`) | filename + dialog filters in `src/main/export/filename.ts`; `ExportManager` (`export-manager.ts`, 654 lines) streams pages, never materializes the whole result |
| File-import tokens | **30 min TTL** (`TOKEN_TTL_MS`, `DataTransferCoordinator`) | descriptor → preview → start; expired token = restart the dialog flow, not a retry |
| Global search | caller-supplied `maxCollections` / `maxDocumentsPerCollection` / `maxResults` | skips `system.*`, substring-matches canonical EJSON, returns `{ matches, scannedCollections, scannedDocuments, truncated, sampled: true }` — always render the `sampled/truncated` flags, it's a sample not a census |
| Change streams | `maxAwaitTimeMS: 1000`, bounded `pollStream(streamId, maxEvents)` | non-blocking poll; registry-owned stream handle with the same idle-TTL rules as cursors (`docs/runtime-lifecycle.md`) |
| GridFS | explicit `limit` on list (uploadDate desc), ids must be ObjectId EJSON | metadata parsed via strict-EJSON doc parser; invalid id → `Validation`, never a cast-and-crash |
| Database rename | dedicated coordinator (`database-rename/coordinator.ts`, 178 lines) + progress events | same dialog/progress/cancel shape as data jobs; renderer mirrors in `stores/database-renames.ts` (transient) |

When adding a data path: add the zod schema + channel (`docs/ipc-howto.md`),
keep the byte/document caps next to the code as exported consts (like the
examples above), stream — never buffer — unbounded inputs, and add BOTH unit
(fakes/bounds) and integration (real mongod) tests (`docs/testing.md`).
