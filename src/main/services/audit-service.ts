import { randomUUID } from 'node:crypto';
import type {
  AuditBucket,
  AuditChangedEvent,
  AuditFilter,
  AuditListPage,
  AuditLogEntry,
  AuditSummary,
  EngineEvent,
  ExportProgressEvent,
} from '../../shared/domain/index.js';
import { normalizeApplicationSettings } from '../../shared/domain/workspace.js';
import { serializeError } from '../../shared/errors/index.js';
import { containsKnownSecretMaterial, redactForLog } from '../../shared/redaction/index.js';
import type { Database } from '../storage/database.js';
import type { FinishAuditInput } from '../storage/repositories/audit.js';

const MAX_DETAIL_BYTES = 32 * 1024;

export interface AuditContext {
  correlationId?: string;
  connectionId?: string;
  connectionName?: string;
  database?: string;
  collection?: string;
  category: AuditLogEntry['category'];
  action: string;
  origin: AuditLogEntry['origin'];
  operationClass: AuditLogEntry['operationClass'];
  summary: string;
  detail?: Record<string, unknown>;
}

interface ActiveQuery {
  id: string;
  startedAt: number;
  connectionId?: string;
  resultCount: number;
  affectedCount: number;
  write: boolean;
  errorCategory?: string;
  errorMessage?: string;
}

interface ActiveExport {
  id: string;
  startedAt: number;
  connectionId?: string;
}

export class AuditService {
  private healthy = true;
  private healthMessage: string | undefined;
  private changesSincePrune = 0;
  private emitChange: (event: AuditChangedEvent) => void = () => undefined;
  private activeQueries = new Map<string, ActiveQuery>();
  private activeExports = new Map<string, ActiveExport>();
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(private readonly db: Database) {}

  initialize(): void {
    this.tryAuditWrite(() => {
      this.db.audit.markRunningInterrupted();
      this.pruneNow();
    });
    if (!this.pruneTimer) {
      this.pruneTimer = setInterval(() => {
        this.tryAuditWrite(() => { this.pruneNow(); });
      }, 15 * 60 * 1_000);
      this.pruneTimer.unref?.();
    }
  }

  dispose(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
  }

  setChangeEmitter(emitter: (event: AuditChangedEvent) => void): void {
    this.emitChange = emitter;
  }

  begin(context: AuditContext): string | null {
    const id = randomUUID();
    const startedAt = Date.now();
    const connectionName = sanitizeStoredText(context.connectionName ?? (
      context.connectionId
        ? this.db.profiles.byId(context.connectionId)?.name ?? 'Deleted connection'
        : 'Temporary connection'
    ), 200);
    const ok = this.tryAuditWrite(() => {
      this.db.audit.begin({
        id,
        startedAt,
        ...(context.correlationId ? { correlationId: context.correlationId } : {}),
        ...(context.connectionId ? { connectionId: context.connectionId } : {}),
        connectionName,
        ...(context.database ? { database: sanitizeStoredText(context.database, 255) } : {}),
        ...(context.collection ? { collection: sanitizeStoredText(context.collection, 255) } : {}),
        category: context.category,
        action: context.action,
        origin: context.origin,
        operationClass: context.operationClass,
        summary: sanitizeStoredText(context.summary, 500),
        ...(context.detail ? { detail: sanitizeDetail(context.detail) } : {}),
      });
      this.emitChange({ kind: 'created', entryId: id });
      this.changesSincePrune += 1;
      if (this.changesSincePrune >= 100) {
        this.changesSincePrune = 0;
        this.pruneNow();
      }
    });
    return ok ? id : null;
  }

  finish(id: string | null, startedAt: number, update: Partial<FinishAuditInput> & { status: FinishAuditInput['status'] }): void {
    if (!id) return;
    const completedAt = Date.now();
    this.tryAuditWrite(() => {
      this.db.audit.finish(id, {
        completedAt,
        durationMs: update.durationMs ?? completedAt - startedAt,
        status: update.status,
        ...(update.operationClass ? { operationClass: update.operationClass } : {}),
        ...(update.errorCategory ? { errorCategory: update.errorCategory } : {}),
        ...(update.errorMessage ? { errorMessage: sanitizeErrorMessage(update.errorMessage) } : {}),
        ...(update.resultCount !== undefined ? { resultCount: update.resultCount } : {}),
        ...(update.affectedCount !== undefined ? { affectedCount: update.affectedCount } : {}),
      });
      this.emitChange({ kind: 'updated', entryId: id });
    });
  }

  async run<T>(
    context: AuditContext,
    operation: () => Promise<T>,
    summarize?: (value: T) => Partial<FinishAuditInput>,
  ): Promise<T> {
    const startedAt = Date.now();
    const id = this.begin(context);
    try {
      const value = await operation();
      const extra = summarize?.(value) ?? {};
      this.finish(id, startedAt, { ...extra, status: extra.status ?? 'success' });
      return value;
    } catch (error) {
      const serialized = serializeError(error);
      const cancelled = serialized.category === 'Cancellation';
      this.finish(id, startedAt, {
        status: cancelled ? 'cancelled' : 'error',
        errorCategory: serialized.category,
        errorMessage: serialized.message,
      });
      throw error;
    }
  }

  beginQuery(context: AuditContext & { correlationId: string }): void {
    const startedAt = Date.now();
    const id = this.begin(context);
    if (!id) return;
    this.activeQueries.set(context.correlationId, {
      id,
      startedAt,
      ...(context.connectionId ? { connectionId: context.connectionId } : {}),
      resultCount: 0,
      affectedCount: 0,
      write: false,
    });
  }

  failQueryStart(correlationId: string, error: unknown): void {
    const active = this.activeQueries.get(correlationId);
    if (!active) return;
    const serialized = serializeError(error);
    this.dbFinishQuery(correlationId, {
      status: 'error',
      errorCategory: serialized.category,
      errorMessage: serialized.message,
    });
  }

  failQueriesForConnection(connectionId: string, message: string): void {
    for (const [correlationId, active] of [...this.activeQueries]) {
      if (active.connectionId !== connectionId) continue;
      this.dbFinishQuery(correlationId, {
        status: 'interrupted',
        errorCategory: 'UtilityProcessCrash',
        errorMessage: message,
      });
    }
  }

  beginExport(context: AuditContext & { correlationId: string }): void {
    const startedAt = Date.now();
    const id = this.begin(context);
    if (!id) return;
    this.activeExports.set(context.correlationId, {
      id,
      startedAt,
      ...(context.connectionId ? { connectionId: context.connectionId } : {}),
    });
  }

  failExportStart(correlationId: string, error: unknown): void {
    const active = this.activeExports.get(correlationId);
    if (!active) return;
    const serialized = serializeError(error);
    this.activeExports.delete(correlationId);
    this.finish(active.id, active.startedAt, {
      status: 'error',
      errorCategory: serialized.category,
      errorMessage: serialized.message,
    });
  }

  handleExportEvent(event: ExportProgressEvent): void {
    if (event.status === 'running') return;
    const active = this.activeExports.get(event.jobId);
    if (!active) return;
    this.activeExports.delete(event.jobId);
    this.finish(active.id, active.startedAt, {
      status: event.status === 'completed'
        ? 'success'
        : event.status === 'cancelled'
          ? 'cancelled'
          : 'error',
      resultCount: event.processedRows,
      ...(event.status === 'error'
        ? { errorCategory: 'Export', errorMessage: event.message ?? 'Export failed.' }
        : {}),
    });
  }

  failExportsForConnection(connectionId: string, message: string): void {
    for (const [jobId, active] of [...this.activeExports]) {
      if (active.connectionId !== connectionId) continue;
      this.activeExports.delete(jobId);
      this.finish(active.id, active.startedAt, {
        status: 'interrupted',
        errorCategory: 'UtilityProcessCrash',
        errorMessage: message,
      });
    }
  }

  handleEngineEvent(runId: string | undefined, event: EngineEvent): void {
    if (!runId) return;
    const active = this.activeQueries.get(runId);
    if (!active) return;
    if (event.type === 'result') {
      if (event.result.kind === 'documents') {
        active.resultCount += event.result.documents.length;
      } else if (event.result.kind === 'write') {
        active.write = true;
        active.affectedCount += (event.result.insertedCount ?? 0) +
          (event.result.modifiedCount ?? 0) +
          (event.result.deletedCount ?? 0) +
          (event.result.upsertedCount ?? 0);
      }
      return;
    }
    if (event.type === 'statement-error') {
      active.errorCategory = event.error.category;
      active.errorMessage = event.error.message;
      return;
    }
    if (event.type === 'execution-finished') {
      this.dbFinishQuery(runId, {
        status: event.status === 'completed' ? 'success' : event.status === 'cancelled' ? 'cancelled' : 'error',
        durationMs: event.durationMs,
        operationClass: active.write ? 'write' : 'read',
        resultCount: active.resultCount,
        affectedCount: active.affectedCount,
        ...(active.errorCategory ? { errorCategory: active.errorCategory } : {}),
        ...(active.errorMessage ? { errorMessage: active.errorMessage } : {}),
      });
    }
  }

  list(filter: AuditFilter, limit: number, offset: number): AuditListPage {
    return this.db.audit.list(filter, limit, offset);
  }

  summary(filter: AuditFilter, bucket: AuditBucket): AuditSummary {
    return {
      ...this.db.audit.summary(filter, bucket),
      health: { healthy: this.healthy, ...(this.healthMessage ? { message: this.healthMessage } : {}) },
    };
  }

  deleteEntry(id: string): number {
    const count = this.db.audit.remove(id);
    if (count) this.emitChange({ kind: 'deleted', entryId: id });
    return count;
  }

  clear(filter?: AuditFilter): number {
    const count = this.db.audit.clear(filter);
    this.emitChange({ kind: 'cleared' });
    return count;
  }

  pruneNow(): number {
    const settings = normalizeApplicationSettings(this.db.settings.get());
    return this.db.audit.prune(settings.audit.retentionDays, settings.audit.maxEntries);
  }

  pruneSafely(): number {
    let count = 0;
    this.tryAuditWrite(() => { count = this.pruneNow(); });
    return count;
  }

  private dbFinishQuery(correlationId: string, update: Partial<FinishAuditInput> & { status: FinishAuditInput['status'] }): void {
    const active = this.activeQueries.get(correlationId);
    if (!active) return;
    this.activeQueries.delete(correlationId);
    this.finish(active.id, active.startedAt, update);
  }

  private tryAuditWrite(operation: () => void): boolean {
    try {
      operation();
      if (!this.healthy) {
        this.healthy = true;
        this.healthMessage = undefined;
        this.emitChange({ kind: 'health' });
      }
      return true;
    } catch (error) {
      this.healthy = false;
      this.healthMessage = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
      this.emitChange({ kind: 'health' });
      return false;
    }
  }
}

function sanitizeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  if (containsKnownSecretMaterial(detail)) {
    return { value: '[redacted: credential material detected]' };
  }
  const redacted = redactForLog(detail) as Record<string, unknown>;
  const json = JSON.stringify(redacted);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= MAX_DETAIL_BYTES) return redacted;
  return {
    preview: truncateUtf8(json, MAX_DETAIL_BYTES - 300),
    truncated: true,
    originalBytes: bytes,
  };
}

function sanitizeErrorMessage(message: string): string {
  return String(redactForLog(message)).slice(0, 2_000);
}

function sanitizeStoredText(value: string, maxLength: number): string {
  if (containsKnownSecretMaterial(value)) return '[redacted: credential material detected]';
  return String(redactForLog(value)).slice(0, maxLength);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString('utf8');
}
