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
 *   -> { id, type: 'cursor-full', cursorId, fullValueId }
 *   -> { id, type: 'cursor-close', cursorId }
 *   -> { id, type: 'sample-schema', database, collection, sampleSize? }
 *   -> { id, type: 'list-databases' }
 *   -> { id, type: 'list-collections', database }
 *   -> { id, type: 'shutdown' }
 *  <- { id, ok: true, value? } | { id, ok: false, error: AppError }
 *  <- { type: 'engine-event', executionId, event }     (streamed, no id)
 */
import { randomUUID } from 'node:crypto';
import { MongoClient, type MongoClientOptions } from 'mongodb';
import { ExecutionEngine } from './engine/execute.js';
import { CursorRegistry } from './registry/cursors.js';
import { sampleSchema } from './metadata/sample.js';
import { classifyError, serializeError, type AppError } from '../shared/errors/index.js';
import { redactUri } from '../shared/redaction/index.js';
import type { ExecuteRequest } from '../shared/domain/index.js';

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
const engine = new ExecutionEngine(registry);

let client: MongoClient | null = null;
let serverVersion = 'unknown';

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
      reply(req.id, { cancelled: engine.cancel(req.executionId as string) });
      return;
    }
    case 'cursor-next': {
      const page = await registry.fetchNext(
        req.cursorId as string,
        (req.pageSize as number | undefined) ?? 50,
      );
      reply(req.id, page);
      return;
    }
    case 'cursor-prev': {
      reply(req.id, registry.fetchPrev(req.cursorId as string));
      return;
    }
    case 'cursor-full': {
      reply(
        req.id,
        registry.fetchFullValue(req.cursorId as string, req.fullValueId as string),
      );
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
      const cols = await db
        .listCollections({}, { nameOnly: true })
        .toArray();
      reply(req.id, cols);
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
  await registry.dispose().catch(() => undefined);
  if (client) await client.close(true).catch(() => undefined);
  process.exit(code);
}

parentPort.on('message', ({ data }) => {
  handle(data).catch((err) => replyError(data.id, err));
});

parentPort.postMessage({ type: 'ready', pid: process.pid });

// Crash hygiene: never die silently with pending work.
process.on?.('unhandledRejection', (err) => {
  parentPort.postMessage({
    type: 'runtime-error',
    error: serializeError(err),
  });
});
