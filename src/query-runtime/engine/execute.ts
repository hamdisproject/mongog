/**
 * Sequential multi-statement execution engine (plan §H).
 *
 * Pipeline: parse -> policy scans -> instrument -> vm execution with real
 * driver objects -> per-statement capture/classification -> serialized
 * results streamed as EngineEvents.
 */
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import * as mongodb from 'mongodb';
import {
  buildInstrumentedSource,
  parseScript,
  type ScriptLanguage,
} from '../../features/script-analysis/index.js';
import type {
  EngineEvent,
  ExecutionMode,
  QueryResult,
  StatementInfo,
} from '../../shared/domain/index.js';
import {
  appError,
  classifyError,
  MongoGCancellationError,
  type AppError,
} from '../../shared/errors/index.js';
import { serializeToEjson } from '../../shared/ejson/index.js';
import { CursorRegistry, type CursorOwner } from '../registry/cursors.js';
import { createSandbox } from './sandbox.js';
import { scanQueryModeViolations, scanWriteOperations } from './policy.js';

export interface ExecuteOptions {
  client: mongodb.MongoClient;
  database: string;
  source: string;
  sourceOffset?: { line: number; column: number };
  mode: ExecutionMode;
  readOnly?: boolean;
  pageSize?: number;
  /** 0 = no engine-side timeout (Trusted Mode only, behind UI confirm). */
  timeoutMS?: number;
  language?: ScriptLanguage;
  registry: CursorRegistry;
  owner: CursorOwner;
  executionId?: string;
  /** External cancellation (e.g. supervisor-level cancel). */
  signal?: AbortSignal;
}

export interface ExecutionHandle {
  executionId: string;
  promise: Promise<void>;
  cancel: () => void;
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_TIMEOUT_MS = 30_000;

export class ExecutionEngine {
  private active = new Map<string, { scope: ExecutionScope }>();

  constructor(private readonly registry: CursorRegistry) {}

  execute(opts: ExecuteOptions, emit: (e: EngineEvent) => void): ExecutionHandle {
    const executionId = opts.executionId ?? randomUUID();
    const scope = new ExecutionScope(opts.signal);
    this.active.set(executionId, { scope });

    const promise = this.run(executionId, scope, opts, emit).finally(() => {
      this.active.delete(executionId);
    });
    return { executionId, promise, cancel: () => scope.cancel() };
  }

  cancel(executionId: string): boolean {
    return this.active.get(executionId)?.scope.cancel() ?? false;
  }

  private async run(
    executionId: string,
    scope: ExecutionScope,
    opts: ExecuteOptions,
    emit: (e: EngineEvent) => void,
  ): Promise<void> {
    const startedAt = performance.now();
    const finish = (status: 'completed' | 'failed' | 'cancelled') =>
      emit({ type: 'execution-finished', status, durationMs: performance.now() - startedAt });

    // ---- 1. Parse --------------------------------------------------------
    const parsed = parseScript(opts.source, opts.language ?? 'typescript');
    const editorRange = (range: import('../../shared/errors/index.js').SourceRange) =>
      offsetSourceRange(range, opts.sourceOffset);
    const statements: StatementInfo[] = parsed.statements.map((s) => ({
      index: s.index,
      range: editorRange(s.range),
      kind: s.kind,
    }));
    emit({ type: 'execution-started', executionId, statements });

    if (parsed.diagnostics.length > 0) {
      const d = parsed.diagnostics[0]!;
      const range = editorRange(d.range);
      emit({
        type: 'statement-error',
        index: -1,
        range,
        error: appError('InvalidQuerySyntax', d.message, { statementRange: range }),
        durationMs: 0,
      });
      return finish('failed');
    }

    // ---- 2. Policy scans ---------------------------------------------------
    if (opts.mode === 'query') {
      const v = scanQueryModeViolations(parsed.sourceFile)[0];
      if (v) {
        const range = editorRange(v.range);
        emit({
          type: 'statement-error',
          index: -1,
          range,
          error: appError('ModuleNotAllowed', v.message, { statementRange: range }),
          durationMs: 0,
        });
        return finish('failed');
      }
    }
    if (opts.readOnly) {
      const v = scanWriteOperations(parsed.sourceFile)[0];
      if (v) {
        const range = editorRange(v.range);
        emit({
          type: 'statement-error',
          index: -1,
          range,
          error: appError('ReadOnlyProtection', v.message, {
            statementRange: range,
            hint: 'This connection is marked read-only. Use server-side roles for authoritative control.',
          }),
          durationMs: 0,
        });
        return finish('failed');
      }
    }

    // ---- 3. Instrument -----------------------------------------------------
    const instrumented = buildInstrumentedSource(opts.source, parsed);
    const promiseProbes = new Map(instrumented.promiseProbes.map((probe) => [probe.id, probe]));
    const emittedPromiseWarnings = new Set<string>();
    const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;

    const emitPromiseWarning = (
      key: string,
      warning: Omit<Extract<EngineEvent, { type: 'statement-warning' }>, 'type'>,
    ): void => {
      if (emittedPromiseWarnings.has(key)) return;
      emittedPromiseWarnings.add(key);
      emit({ type: 'statement-warning', ...warning });
    };

    const capture = async (index: number, thunk: () => Promise<unknown>): Promise<unknown> => {
      scope.throwIfCancelled();
      const stmt = parsed.statements[index];
      const range = stmt
        ? editorRange(stmt.range)
        : editorRange({ startLine: 1, startCol: 1, endLine: 1, endCol: 1 });
      scope.currentIndex = index;
      emit({ type: 'statement-started', index, range });
      const t0 = performance.now();
      let value: unknown;
      try {
        value = await thunk();
      } catch (err) {
        const durationMs = performance.now() - t0;
        const error = scope.cancelled
          ? appError('Cancellation', 'Statement cancelled.')
          : classifyError(err, range);
        scope.errorReported = true;
        emit({ type: 'statement-error', index, range, error, durationMs });
        throw err;
      }
      const durationMs = performance.now() - t0;
      scope.throwIfCancelled();
      if (value === undefined) return undefined;

      try {
        const result = await this.classify(value, opts, scope, pageSize);
        if (result) emit({ type: 'result', index, range, result, durationMs });
      } catch (err) {
        emit({
          type: 'statement-error',
          index,
          range,
          error: classifyError(err, range),
          durationMs,
        });
        throw err;
      }
      return undefined;
    };

    const sandbox = createSandbox({
      client: opts.client,
      database: opts.database,
      mode: opts.mode,
      capture: (i, t) => capture(i, t),
      mark: (i) => {
        scope.currentIndex = i;
      },
      inspectPromise: (probeId, value) => {
        if (!isThenable(value)) return;
        const probe = promiseProbes.get(probeId);
        if (!probe) return;
        emitPromiseWarning(`binding:${probeId}`, {
          index: probe.statementIndex,
          range: editorRange(probe.range),
          code: 'UnawaitedPromise',
          message: `Variable "${probe.bindingName}" contains an unresolved Promise. Add await before this expression.`,
          hint: 'The query will continue with normal JavaScript Promise semantics.',
          fix: {
            title: 'Add await',
            range: editorRange(probe.fixRange),
            text: 'await ',
          },
        });
      },
      onConsole: (entry) => emit({ type: 'console', entry }),
      onConsolePromise: (statementIndex) => {
        const statement = parsed.statements[statementIndex];
        const range = statement
          ? editorRange(statement.range)
          : editorRange({ startLine: 1, startCol: 1, endLine: 1, endCol: 1 });
        emitPromiseWarning(`console:${statementIndex}`, {
          index: statementIndex,
          range,
          code: 'UnawaitedPromise',
          message: 'Console received an unresolved Promise. Add await to inspect its resolved value.',
          hint: 'The Promise was not awaited automatically; execution continues unchanged.',
        });
      },
      currentStatementIndex: () => scope.currentIndex,
    });

    // ---- 4. Execute --------------------------------------------------------
    const timeoutMS =
      opts.timeoutMS ?? (opts.mode === 'trusted' ? 0 : DEFAULT_TIMEOUT_MS);
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMS > 0) {
      timer = setTimeout(() => scope.cancel(), timeoutMS);
      timer.unref?.();
    }

    let script: vm.Script;
    try {
      script = new vm.Script(instrumented.code, { filename: 'mongog-exec.js' });
    } catch (err) {
      if (timer) clearTimeout(timer);
      emit({
        type: 'statement-error',
        index: -1,
        range: editorRange({ startLine: 1, startCol: 1, endLine: 1, endCol: 1 }),
        error: classifyError(
          err,
          editorRange({ startLine: 1, startCol: 1, endLine: 1, endCol: 1 }),
        ),
        durationMs: 0,
      });
      return finish('failed');
    }

    let completed = false;
    try {
      const result = script.runInContext(sandbox.context) as Promise<unknown>;
      await scope.raceCancellation(Promise.resolve(result));
      if (timer) clearTimeout(timer);
      completed = true;
      finish('completed');
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (scope.cancelled || err instanceof MongoGCancellationError) {
        emitSkippedRemaining(statements, scope.currentIndex, emit, 'cancelled');
        finish('cancelled');
      } else {
        // The failing statement already emitted its own statement-error via
        // capture()/mark(); non-captured statements get attribution here.
        if (!scope.errorReported) {
          const idx = scope.currentIndex;
          const stmt = parsed.statements[idx];
          const range = stmt
            ? editorRange(stmt.range)
            : editorRange({ startLine: 1, startCol: 1, endLine: 1, endCol: 1 });
          emit({
            type: 'statement-error',
            index: idx,
            range,
            error: classifyError(err, range),
            durationMs: 0,
          });
        }
        emitSkippedRemaining(statements, scope.currentIndex, emit, 'error');
        finish('failed');
      }
    } finally {
      // On success, cursors stay OPEN for interactive paging (owned by the
      // registry). On cancel/failure they are closed: the result set is dead.
      await scope.cleanup(this.registry, { closeTracked: !completed });
    }
  }

  /** Classify a captured value into a QueryResult (cursor/write/scalar/...). */
  private async classify(
    value: unknown,
    opts: ExecuteOptions,
    scope: ExecutionScope,
    pageSize: number,
  ): Promise<QueryResult | null> {
    // Awaiting again is harmless (thunk already awaited) and covers thenables
    // returned from sync thunks.
    if (isThenable(value)) value = await value;

    if (value instanceof mongodb.AbstractCursor) {
      const cursorId = this.registry.register(value, opts.owner, namespaceOf(value));
      scope.trackCursor(cursorId);
      const page = await this.registry.fetchNext(cursorId, pageSize);
      return {
        kind: 'documents',
        cursorId,
        documents: page.documents,
        pageSize,
        hasMore: page.hasMore,
      };
    }

    if (value instanceof mongodb.ChangeStream) {
      const streamId = this.registry.registerStream(value, opts.owner);
      scope.trackStream(streamId);
      return { kind: 'changeStream', streamId, buffered: 0 };
    }

    const write = detectWriteResult(value);
    if (write) {
      return {
        kind: 'write',
        op: write.op,
        ...(write.counts as Record<string, number>),
        raw: serializeToEjson(write.raw, 64 * 1024),
      };
    }

    if (typeof value === 'function') {
      return { kind: 'opaque', preview: `[Function ${value.name || 'anonymous'}]` };
    }

    try {
      return { kind: 'scalar', value: serializeToEjson(value) };
    } catch {
      return { kind: 'opaque', preview: String(value) };
    }
  }
}

function emitSkippedRemaining(
  statements: StatementInfo[],
  currentIndex: number,
  emit: (e: EngineEvent) => void,
  reason: 'cancelled' | 'error',
): void {
  for (const statement of statements) {
    if (statement.index > currentIndex) {
      emit({
        type: 'statement-skipped',
        index: statement.index,
        range: statement.range,
        reason,
      });
    }
  }
}

export function offsetSourceRange(
  range: import('../../shared/errors/index.js').SourceRange,
  offset: { line: number; column: number } | undefined,
): import('../../shared/errors/index.js').SourceRange {
  if (!offset || (offset.line === 0 && offset.column === 0)) return range;
  return {
    startLine: range.startLine + offset.line,
    startCol: range.startCol + (range.startLine === 1 ? offset.column : 0),
    endLine: range.endLine + offset.line,
    endCol: range.endCol + (range.endLine === 1 ? offset.column : 0),
  };
}

/** Mutable per-execution scope: cancellation + tracked resources. */
class ExecutionScope {
  readonly controller = new AbortController();
  currentIndex = -1;
  errorReported = false;
  private cursors = new Set<string>();
  private streams = new Set<string>();
  private cancelPromise: Promise<never>;

  constructor(externalSignal?: AbortSignal) {
    this.cancelPromise = new Promise<never>((_resolve, reject) => {
      this.controller.signal.addEventListener('abort', () => {
        reject(new MongoGCancellationError());
      });
    });
    // Avoid unhandled rejection warnings when the race never consumes it.
    this.cancelPromise.catch(() => undefined);
    externalSignal?.addEventListener('abort', () => this.cancel());
  }

  get cancelled(): boolean {
    return this.controller.signal.aborted;
  }

  cancel(): boolean {
    if (this.cancelled) return false;
    this.controller.abort();
    return true;
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new MongoGCancellationError();
  }

  raceCancellation<T>(p: Promise<T>): Promise<T> {
    return Promise.race([p, this.cancelPromise]);
  }

  trackCursor(id: string): void {
    this.cursors.add(id);
  }

  trackStream(id: string): void {
    this.streams.add(id);
  }

  /** Close execution-scoped cursors/streams (only on cancel/failure). */
  async cleanup(registry: CursorRegistry, opts: { closeTracked: boolean }): Promise<void> {
    if (opts.closeTracked) {
      for (const id of this.cursors) await registry.close(id).catch(() => undefined);
      for (const id of this.streams) await registry.closeStream(id).catch(() => undefined);
    }
    this.cursors.clear();
    this.streams.clear();
  }
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return false;
  try {
    return typeof (v as { then?: unknown }).then === 'function';
  } catch {
    return false;
  }
}

function namespaceOf(cursor: mongodb.AbstractCursor): string {
  const ns = (cursor as unknown as { namespace?: { db?: string; collection?: string } }).namespace;
  return ns ? `${ns.db ?? ''}.${ns.collection ?? ''}` : '';
}

interface WriteDetection {
  op: 'insert' | 'update' | 'delete' | 'bulk';
  counts: {
    insertedCount?: number;
    modifiedCount?: number;
    deletedCount?: number;
    upsertedCount?: number;
    matchedCount?: number;
  };
  raw: unknown;
}

/**
 * Duck-typed write-result detection. Driver result classes are not all
 * reliably exported across versions; shape detection is version-resilient.
 */
function detectWriteResult(value: unknown): WriteDetection | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.acknowledged !== 'boolean') return null;

  if ('insertedId' in v) {
    return { op: 'insert', counts: { insertedCount: 1 }, raw: value };
  }
  if ('insertedIds' in v && typeof v.insertedCount === 'number' && !('modifiedCount' in v)) {
    return { op: 'insert', counts: { insertedCount: v.insertedCount }, raw: value };
  }
  if (
    typeof v.insertedCount === 'number' &&
    typeof v.modifiedCount === 'number' &&
    typeof v.deletedCount === 'number'
  ) {
    // BulkWriteResult / ClientBulkWriteResult
    return {
      op: 'bulk',
      counts: {
        insertedCount: v.insertedCount,
        modifiedCount: v.modifiedCount,
        deletedCount: v.deletedCount,
        ...(typeof v.upsertedCount === 'number' ? { upsertedCount: v.upsertedCount } : {}),
        ...(typeof v.matchedCount === 'number' ? { matchedCount: v.matchedCount } : {}),
      },
      raw: value,
    };
  }
  if (typeof v.deletedCount === 'number') {
    return { op: 'delete', counts: { deletedCount: v.deletedCount }, raw: value };
  }
  if (typeof v.matchedCount === 'number' || typeof v.modifiedCount === 'number') {
    return {
      op: 'update',
      counts: {
        ...(typeof v.matchedCount === 'number' ? { matchedCount: v.matchedCount } : {}),
        ...(typeof v.modifiedCount === 'number' ? { modifiedCount: v.modifiedCount } : {}),
        ...(typeof v.upsertedCount === 'number' ? { upsertedCount: v.upsertedCount } : {}),
      },
      raw: value,
    };
  }
  return null;
}
