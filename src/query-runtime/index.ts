/**
 * Query runtime entry point — runs inside Electron utilityProcess.
 *
 * Protocol (postMessage envelopes):
 *   -> { id, type: 'init', uri, options?, database }   connect MongoClient
 *   -> { id, type: 'ping' }
 *   -> { id, type: 'execute', request }                streams engine events
 *   -> { id, type: 'cancel', executionId }
 *   -> { id, type: 'cursor-next', cursorId, pageSize? }
 *   -> { id, type: 'cursor-prev', cursorId }
 *   -> { id, type: 'fetch-cancel', operationId }
 *   -> { id, type: 'cursor-full', cursorId, fullValueId }
 *   -> { id, type: 'cursor-close', cursorId }
 *   -> { id, type: 'sample-schema', database, collection, sampleSize? }
 *   -> { id, type: 'list-databases' }
 *   -> { id, type: 'list-collections', database }
 *   -> { id, type: 'collection-find', ... }
 *   -> { id, type: 'collection-insert' | 'collection-replace' | 'collection-delete', ... }
 *   -> { id, type: 'shutdown' }
 *  <- { id, ok: true, value? } | { id, ok: false, error: AppError }
 *  <- { type: 'engine-event', executionId, event }     (streamed, no id)
 */
import { randomUUID } from 'node:crypto';
import { MongoClient, type MongoClientOptions } from 'mongodb';
import { ExecutionEngine } from './engine/execute.js';
import { CursorRegistry } from './registry/cursors.js';
import { FetchOperationRegistry } from './registry/fetch-operations.js';
import { sampleSchema } from './metadata/sample.js';
import {
  countCollectionDocuments,
  deleteCollectionDocument,
  dropCollection,
  dropDatabase,
  findCollectionDocuments,
  insertCollectionDocument,
  renameCollection,
  replaceCollectionDocument,
} from './collection/operations.js';
import {
  createCollectionIndex,
  deleteGridFsFile,
  downloadGridFsFile,
  dropCollectionIndex,
  explainCollectionFind,
  globalSearch,
  listGridFsFiles,
  listIndexes,
  pollChangeStream,
  startChangeStream,
  uploadGridFsFile,
} from './admin/operations.js';
import { classifyError, serializeError, type AppError } from '../shared/errors/index.js';
import { redactUri } from '../shared/redaction/index.js';
import type { ExecuteRequest, ExplainVerbosity } from '../shared/domain/index.js';
import {
  ExportManager,
  type RuntimeCollectionExportRequest,
  type RuntimeQueryExportRequest,
} from './export/export-manager.js';
import { CopySourceManager, type SourceMetadata } from './data-transfer/copy-source.js';
import { FileImportManager, type RuntimeFileDataset } from './data-transfer/file-import.js';
import { writeTransferBatch, type TransferWriteRequest } from './data-transfer/write.js';
import { finalizeTransferIndexes, prepareTransferTarget } from './data-transfer/metadata.js';
import type { DataMetadataSelection } from '../shared/domain/index.js';

interface RuntimeRequest {
  id: number;
  type: string;
  [key: string]: unknown;
}

interface ParentPortLike {
  on(event: 'message', listener: (e: { data: RuntimeRequest }) => void): void;
  postMessage(message: unknown): void;
}

// Electron utility-process global; not present in @types/node.
const parentPort = (process as unknown as { parentPort: ParentPortLike }).parentPort;

const registry = new CursorRegistry();
registry.startSweeper();
const fetchOperations = new FetchOperationRegistry();
const engine = new ExecutionEngine(registry);
const exportsManager = new ExportManager(registry, (event) => {
  parentPort.postMessage({ type: 'export-event', event });
});
const copySourceManager = new CopySourceManager();
const fileImportManager = new FileImportManager((event) => {
  if (isTerminalDataJob(event.status) && dataTransferLockId === event.jobId) dataTransferLockId = null;
  parentPort.postMessage({ type: 'data-job-event', event });
});

let client: MongoClient | null = null;
let serverVersion = 'unknown';
let shuttingDown = false;
let dataTransferLockId: string | null = null;

function reply(id: number, value: unknown): void {
  parentPort.postMessage({ id, ok: true, value });
}

function replyError(id: number, err: unknown): void {
  parentPort.postMessage({ id, ok: false, error: serializeError(err) });
}

function requireClient(): MongoClient {
  if (!client) {
    const err: AppError = {
      category: 'ServerSelection',
      message: 'Runtime has no active MongoClient; call init first.',
    };
    throw err;
  }
  return client;
}

async function handle(req: RuntimeRequest): Promise<void> {
  switch (req.type) {
    case 'ping': {
      reply(req.id, { pong: true, pid: process.pid, serverVersion });
      return;
    }
    case 'init': {
      const uri = req.uri as string;
      const options = (req.options ?? {}) as MongoClientOptions;
      if (client) await client.close(true).catch(() => undefined);
      client = new MongoClient(uri, {
        appName: 'MongoG',
        timeoutMS: 30_000, // CSOT default; per-call overrides still apply
        ...options,
      });
      await client.connect();
      const hello = await client.db('admin').command({ hello: 1 });
      serverVersion = (hello as { version?: string }).version ?? 'unknown';
      reply(req.id, { pid: process.pid, serverVersion, uriRedacted: redactUri(uri) });
      return;
    }
    case 'execute': {
      const request = req.request as ExecuteRequest;
      // Pre-generate the id: the emit closure must not reference the handle
      // (engine events can fire synchronously, before it is assigned — TDZ).
      const executionId = randomUUID();
      const exec = engine.execute(
        {
          client: requireClient(),
          database: request.database,
          source: request.source,
          sourceOffset: request.sourceOffset,
          mode: request.mode,
          ...(request.readOnly !== undefined ? { readOnly: request.readOnly } : {}),
          ...(request.pageSize !== undefined ? { pageSize: request.pageSize } : {}),
          ...(request.timeoutMS !== undefined ? { timeoutMS: request.timeoutMS } : {}),
          registry,
          owner: {
            connectionId: request.connectionId,
            ...(request.tabId ? { tabId: request.tabId } : {}),
          },
          executionId,
        },
        (event) => {
          parentPort.postMessage({
            type: 'engine-event',
            executionId,
            ...(request.tabId ? { tabId: request.tabId } : {}),
            ...(request.runId ? { runId: request.runId } : {}),
            event,
          });
        },
      );
      reply(req.id, { executionId });
      // Completion is delivered via the streamed 'execution-finished' event;
      // the request itself returns immediately so callers stay responsive.
      exec.promise.catch(() => undefined);
      return;
    }
    case 'cancel': {
      // Do not acknowledge until the actual user-script promise has settled.
      // Main races this response against its hard-cancel grace period.
      reply(req.id, {
        cancelled: await engine.cancelAndWait(req.executionId as string),
      });
      return;
    }
    case 'cursor-next': {
      const operationId = req.operationId as string;
      const cursorId = req.cursorId as string;
      fetchOperations.begin(operationId);
      fetchOperations.attachResource(operationId, () => registry.close(cursorId));
      try {
        const page = await registry.fetchNext(
          cursorId,
          (req.pageSize as number | undefined) ?? 50,
        );
        reply(req.id, page);
      } finally {
        fetchOperations.finish(operationId);
      }
      return;
    }
    case 'cursor-prev': {
      const operationId = req.operationId as string;
      const cursorId = req.cursorId as string;
      fetchOperations.begin(operationId);
      fetchOperations.attachResource(operationId, () => registry.close(cursorId));
      try {
        reply(req.id, registry.fetchPrev(cursorId));
      } finally {
        fetchOperations.finish(operationId);
      }
      return;
    }
    case 'fetch-cancel': {
      reply(req.id, { cancelled: await fetchOperations.cancel(req.operationId as string) });
      return;
    }
    case 'cursor-full': {
      reply(
        req.id,
        registry.fetchFullValue(req.cursorId as string, req.fullValueId as string),
      );
      return;
    }
    case 'cursor-metadata': {
      reply(req.id, registry.metadata(req.cursorId as string));
      return;
    }
    case 'cursor-close': {
      await registry.close(req.cursorId as string);
      reply(req.id, { closed: true });
      return;
    }
    case 'owner-close': {
      const count = await registry.closeAllForOwner({
        connectionId: req.connectionId as string,
        tabId: req.tabId as string,
      });
      reply(req.id, { closed: count });
      return;
    }
    case 'sample-schema': {
      const db = requireClient().db(req.database as string);
      const result = await sampleSchema(db, req.collection as string, {
        ...(req.sampleSize !== undefined ? { sampleSize: req.sampleSize as number } : {}),
      });
      reply(req.id, result);
      return;
    }
    case 'list-databases': {
      const admin = requireClient().db('admin');
      const res = await admin.command({ listDatabases: 1, nameOnly: true });
      reply(req.id, (res as { databases?: unknown[] }).databases ?? []);
      return;
    }
    case 'list-collections': {
      const db = requireClient().db(req.database as string);
      const cursor = db.listCollections({}, { nameOnly: true });
      const cols: unknown[] = [];
      try {
        for (;;) {
          const collection = await cursor.next();
          if (!collection) break;
          cols.push(collection);
        }
      } finally {
        await cursor.close().catch(() => undefined);
      }
      reply(req.id, cols);
      return;
    }
    case 'collection-find': {
      const operationId = req.operationId as string;
      const signal = fetchOperations.begin(operationId);
      try {
        const result = await findCollectionDocuments(requireClient(), registry, {
          database: req.database as string,
          collection: req.collection as string,
          owner: {
            connectionId: req.connectionId as string,
            tabId: req.tabId as string,
          },
          filterEjson: req.filterEjson as string,
          ...(req.sortEjson ? { sortEjson: req.sortEjson as string } : {}),
          ...(req.projectionEjson ? { projectionEjson: req.projectionEjson as string } : {}),
          pageSize: req.pageSize as number,
          signal,
          onCursorRegistered: (cursorId) => {
            fetchOperations.attachResource(operationId, () => registry.close(cursorId));
          },
        });
        reply(req.id, result);
      } finally {
        fetchOperations.finish(operationId);
      }
      return;
    }
    case 'collection-count': {
      reply(req.id, await countCollectionDocuments(requireClient(), {
        database: req.database as string,
        collection: req.collection as string,
        filterEjson: req.filterEjson as string,
      }));
      return;
    }
    case 'collection-insert': {
      reply(req.id, await insertCollectionDocument(requireClient(), {
        database: req.database as string,
        collection: req.collection as string,
        documentEjson: req.documentEjson as string,
      }));
      return;
    }
    case 'collection-replace': {
      reply(req.id, await replaceCollectionDocument(requireClient(), {
        database: req.database as string,
        collection: req.collection as string,
        originalDocumentEjson: req.originalDocumentEjson as string,
        documentEjson: req.documentEjson as string,
      }));
      return;
    }
    case 'collection-delete': {
      reply(req.id, await deleteCollectionDocument(requireClient(), {
        database: req.database as string,
        collection: req.collection as string,
        originalDocumentEjson: req.originalDocumentEjson as string,
      }));
      return;
    }
    case 'collection-rename': {
      reply(req.id, await renameCollection(requireClient(), {
        database: req.database as string,
        collection: req.collection as string,
        newName: req.newName as string,
      }));
      return;
    }
    case 'collection-drop': {
      reply(req.id, await dropCollection(requireClient(), {
        database: req.database as string,
        collection: req.collection as string,
      }));
      return;
    }
    case 'database-drop': {
      reply(req.id, await dropDatabase(requireClient(), req.database as string));
      return;
    }
    case 'index-list': {
      reply(req.id, await listIndexes(requireClient(), {
        database: req.database as string,
        collection: req.collection as string,
      }));
      return;
    }
    case 'index-create': {
      reply(req.id, await createCollectionIndex(requireClient(), {
        database: req.database as string,
        collection: req.collection as string,
        keysEjson: req.keysEjson as string,
        ...(req.name ? { name: req.name as string } : {}),
        ...(req.unique !== undefined ? { unique: req.unique as boolean } : {}),
        ...(req.sparse !== undefined ? { sparse: req.sparse as boolean } : {}),
        ...(req.hidden !== undefined ? { hidden: req.hidden as boolean } : {}),
        ...(req.expireAfterSeconds !== undefined
          ? { expireAfterSeconds: req.expireAfterSeconds as number }
          : {}),
        ...(req.partialFilterEjson
          ? { partialFilterEjson: req.partialFilterEjson as string }
          : {}),
      }));
      return;
    }
    case 'index-drop': {
      reply(req.id, await dropCollectionIndex(requireClient(), {
        database: req.database as string,
        collection: req.collection as string,
        name: req.name as string,
      }));
      return;
    }
    case 'explain': {
      reply(req.id, await explainCollectionFind(requireClient(), {
        database: req.database as string,
        collection: req.collection as string,
        filterEjson: req.filterEjson as string,
        ...(req.sortEjson ? { sortEjson: req.sortEjson as string } : {}),
        ...(req.projectionEjson ? { projectionEjson: req.projectionEjson as string } : {}),
        verbosity: req.verbosity as ExplainVerbosity,
      }));
      return;
    }
    case 'global-search': {
      reply(req.id, await globalSearch(requireClient(), {
        database: req.database as string,
        text: req.text as string,
        maxCollections: req.maxCollections as number,
        maxDocumentsPerCollection: req.maxDocumentsPerCollection as number,
        maxResults: req.maxResults as number,
      }));
      return;
    }
    case 'change-start': {
      reply(req.id, startChangeStream(requireClient(), registry, {
        database: req.database as string,
        ...(req.collection ? { collection: req.collection as string } : {}),
        pipelineEjson: req.pipelineEjson as string,
        fullDocument: req.fullDocument as 'default' | 'updateLookup' | 'whenAvailable' | 'required',
        owner: {
          connectionId: req.connectionId as string,
          tabId: req.tabId as string,
        },
      }));
      return;
    }
    case 'change-poll': {
      reply(req.id, await pollChangeStream(
        registry,
        req.streamId as string,
        req.maxEvents as number,
      ));
      return;
    }
    case 'change-close': {
      await registry.closeStream(req.streamId as string);
      reply(req.id, { closed: true });
      return;
    }
    case 'gridfs-list': {
      reply(req.id, await listGridFsFiles(requireClient(), {
        database: req.database as string,
        bucketName: req.bucketName as string,
        limit: req.limit as number,
      }));
      return;
    }
    case 'gridfs-upload': {
      reply(req.id, await uploadGridFsFile(requireClient(), {
        database: req.database as string,
        bucketName: req.bucketName as string,
        sourcePath: req.sourcePath as string,
        ...(req.metadataEjson ? { metadataEjson: req.metadataEjson as string } : {}),
      }));
      return;
    }
    case 'gridfs-download': {
      reply(req.id, await downloadGridFsFile(requireClient(), {
        database: req.database as string,
        bucketName: req.bucketName as string,
        idEjson: req.idEjson as string,
        destinationPath: req.destinationPath as string,
      }));
      return;
    }
    case 'gridfs-delete': {
      reply(req.id, await deleteGridFsFile(requireClient(), {
        database: req.database as string,
        bucketName: req.bucketName as string,
        idEjson: req.idEjson as string,
      }));
      return;
    }
    case 'export-collection-start': {
      assertNoDataTransferLock();
      reply(req.id, exportsManager.start(
        requireClient(),
        req as unknown as RuntimeCollectionExportRequest,
      ));
      return;
    }
    case 'export-query-start': {
      assertNoDataTransferLock();
      reply(req.id, exportsManager.start(
        requireClient(),
        req as unknown as RuntimeQueryExportRequest,
      ));
      return;
    }
    case 'export-cancel': {
      reply(req.id, { cancelled: exportsManager.cancel(req.jobId as string) });
      return;
    }
    case 'data-file-inspect': {
      reply(req.id, await fileImportManager.inspect(req.path as string, req.token as string));
      return;
    }
    case 'data-file-preview': {
      reply(req.id, await fileImportManager.preview(
        req.path as string,
        req.fileToken as string,
        req.sheet as string | undefined,
        req.delimiter as string | undefined,
      ));
      return;
    }
    case 'data-file-import-start': {
      const jobId = req.jobId as string;
      if (dataTransferLockId || exportsManager.hasActiveJob) {
        throw { category: 'Validation', message: 'Another large data job is already using this connection.' };
      }
      dataTransferLockId = jobId;
      try {
        reply(req.id, fileImportManager.start(
          requireClient(),
          req.connectionId as string,
          req.datasets as RuntimeFileDataset[],
          jobId,
        ));
      } catch (error) {
        if (dataTransferLockId === jobId) dataTransferLockId = null;
        throw error;
      }
      return;
    }
    case 'data-file-import-cancel': {
      reply(req.id, { cancelled: fileImportManager.cancel(req.jobId as string) });
      return;
    }
    case 'data-file-import-report': {
      reply(req.id, fileImportManager.report(req.jobId as string));
      return;
    }
    case 'data-transfer-lock': {
      const jobId = req.jobId as string;
      if ((dataTransferLockId && dataTransferLockId !== jobId) || exportsManager.hasActiveJob || fileImportManager.hasActiveJob) {
        throw { category: 'Validation', message: 'Another large data job is already using this connection.' };
      }
      dataTransferLockId = jobId;
      reply(req.id, { locked: true });
      return;
    }
    case 'data-transfer-unlock': {
      if (dataTransferLockId === req.jobId) dataTransferLockId = null;
      reply(req.id, { unlocked: true });
      return;
    }
    // Read-only source protocol. Do not add mutation operations to this group.
    case 'data-source-preview': {
      reply(req.id, await copySourceManager.preview(
        requireClient(),
        req.database as string,
        req.collection as string,
        req.filterSource as string,
      ));
      return;
    }
    case 'data-source-count': {
      reply(req.id, await copySourceManager.count(
        requireClient(),
        req.database as string,
        req.collection as string,
        req.filterSource as string,
      ));
      return;
    }
    case 'data-source-metadata': {
      reply(req.id, await copySourceManager.metadata(
        requireClient(),
        req.database as string,
        req.collection as string,
      ));
      return;
    }
    case 'data-source-open': {
      reply(req.id, copySourceManager.open(
        requireClient(),
        req.database as string,
        req.collection as string,
        req.filterSource as string,
      ));
      return;
    }
    case 'data-source-next': {
      reply(req.id, await copySourceManager.next(req.cursorId as string));
      return;
    }
    case 'data-source-close': {
      await copySourceManager.close(req.cursorId as string);
      reply(req.id, { closed: true });
      return;
    }
    case 'data-target-prepare': {
      reply(req.id, await prepareTransferTarget(
        requireClient(),
        req.database as string,
        req.collection as string,
        req.sourceMetadata as SourceMetadata,
        req.selection as DataMetadataSelection,
      ));
      return;
    }
    case 'data-target-write': {
      reply(req.id, await writeTransferBatch(
        requireClient(),
        req.write as TransferWriteRequest,
      ));
      return;
    }
    case 'data-target-finalize-indexes': {
      reply(req.id, await finalizeTransferIndexes(
        requireClient(),
        req.database as string,
        req.collection as string,
        req.sourceMetadata as SourceMetadata,
        req.selection as DataMetadataSelection,
      ));
      return;
    }
    case 'shutdown': {
      reply(req.id, { bye: true });
      await shutdown(0);
      return;
    }
    default:
      replyError(req.id, { category: 'Unknown', message: `Unknown runtime request: ${req.type}` });
  }
}

async function shutdown(code: number): Promise<never> {
  if (shuttingDown) {
    process.exit(code);
  }
  shuttingDown = true;
  await exportsManager.dispose().catch(() => undefined);
  await fileImportManager.dispose().catch(() => undefined);
  await copySourceManager.dispose().catch(() => undefined);
  await fetchOperations.dispose().catch(() => undefined);
  await registry.dispose().catch(() => undefined);
  if (client) await client.close(true).catch(() => undefined);
  process.exit(code);
}

parentPort.on('message', ({ data }) => {
  handle(data).catch((err) => replyError(data.id, err));
});

parentPort.postMessage({ type: 'ready', pid: process.pid });

function assertNoDataTransferLock(): void {
  if (dataTransferLockId) {
    throw { category: 'Validation', message: 'Another large data job is already using this connection.' };
  }
}

function isTerminalDataJob(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

// Crash hygiene: never die silently with pending work.
process.on?.('unhandledRejection', (err) => {
  parentPort.postMessage({
    type: 'runtime-error',
    error: serializeError(err),
  });
});

process.on?.('SIGTERM', () => { void shutdown(0); });
process.on?.('SIGINT', () => { void shutdown(0); });
