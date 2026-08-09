import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron';
import type {
  CollectionTransferPreview,
  CollectionTransferPreviewInput,
  DataDatasetSummary,
  DataFileDescriptor,
  DataFilePreview,
  DataJobProgressEvent,
  DataJobStartResult,
  DataJobSummary,
  StartConnectionCopyInput,
  StartFileImportInput,
} from '../../shared/domain/index.js';
import { appError, serializeError } from '../../shared/errors/index.js';
import type { RuntimeSupervisor } from '../runtime/supervisor.js';
import type { RuntimeFileDescriptor, RuntimeFileDataset } from '../../query-runtime/data-transfer/file-import.js';
import type { SourceMetadata } from '../../query-runtime/data-transfer/copy-source.js';
import type { TransferWriteResult } from '../../query-runtime/data-transfer/write.js';

interface FileToken {
  path: string;
  name: string;
  format: 'csv' | 'xlsx';
  expiresAt: number;
  connectionId: string;
}

interface ManagedJob {
  kind: 'file-import' | 'connection-copy';
  connectionIds: string[];
  cancelled: boolean;
  report: TransferErrorEntry[];
  runtimeConnectionId?: string;
}

interface TransferErrorEntry {
  dataset: string;
  target: string;
  sourceId?: string;
  category: string;
  message: string;
}

const TOKEN_TTL_MS = 30 * 60 * 1000;

export class DataTransferCoordinator extends EventEmitter {
  private readonly tokens = new Map<string, FileToken>();
  private readonly jobs = new Map<string, ManagedJob>();
  private readonly lockedConnections = new Map<string, string>();

  constructor(private readonly supervisor: RuntimeSupervisor) {
    super();
    supervisor.on('data-job-progress', (_connectionId, event: DataJobProgressEvent) => {
      const job = this.jobs.get(event.jobId);
      if (job && isTerminal(event.status)) this.releaseJob(event.jobId);
      this.emit('progress', event);
    });
    supervisor.on('runtime-exit', (connectionId: string) => this.failJobsForConnection(connectionId));
  }

  async selectFiles(window: BrowserWindow | null, targetConnectionId: string): Promise<DataFileDescriptor[]> {
    const runtime = this.requireRuntime(targetConnectionId);
    const openOptions: OpenDialogOptions = {
      title: 'Select CSV or Excel files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'CSV and Excel', extensions: ['csv', 'xlsx'] },
        { name: 'CSV', extensions: ['csv'] },
        { name: 'Excel', extensions: ['xlsx'] },
      ],
    };
    const result = window
      ? await dialog.showOpenDialog(window, openOptions)
      : await dialog.showOpenDialog(openOptions);
    if (result.canceled) return [];
    const descriptors: DataFileDescriptor[] = [];
    for (const path of result.filePaths) {
      const token = randomUUID();
      let inspected: RuntimeFileDescriptor;
      try {
        inspected = await runtime.request<RuntimeFileDescriptor>('data-file-inspect', { path, token });
      } catch (error) {
        throw pathSafeError(error, path, 'The selected file could not be inspected.');
      }
      this.tokens.set(token, {
        path,
        name: inspected.name,
        format: inspected.format,
        expiresAt: Date.now() + TOKEN_TTL_MS,
        connectionId: targetConnectionId,
      });
      descriptors.push({
        token,
        name: inspected.name,
        format: inspected.format,
        size: inspected.size,
        sheets: inspected.sheets,
      });
    }
    this.sweepTokens();
    return descriptors;
  }

  async previewFile(input: {
    targetConnectionId: string;
    fileToken: string;
    sheet?: string;
    delimiter?: string;
  }): Promise<DataFilePreview> {
    const token = this.resolveToken(input.fileToken, input.targetConnectionId);
    try {
      return await this.requireRuntime(input.targetConnectionId).request<DataFilePreview>('data-file-preview', {
        path: token.path,
        fileToken: input.fileToken,
        ...(input.sheet ? { sheet: input.sheet } : {}),
        ...(input.delimiter ? { delimiter: input.delimiter } : {}),
      });
    } catch (error) {
      throw pathSafeError(error, token.path, 'The selected file could not be previewed.');
    }
  }

  async previewCollection(input: CollectionTransferPreviewInput): Promise<CollectionTransferPreview> {
    return this.requireRuntime(input.connectionId).request('data-source-preview', { ...input });
  }

  async countCollection(input: CollectionTransferPreviewInput): Promise<{ count: number }> {
    return this.requireRuntime(input.connectionId).request('data-source-count', { ...input });
  }

  async startFileImport(input: StartFileImportInput): Promise<DataJobStartResult> {
    this.assertConnectionsAvailable([input.targetConnectionId]);
    const runtime = this.requireRuntime(input.targetConnectionId);
    const datasets: RuntimeFileDataset[] = input.datasets.map((dataset) => {
      const token = this.resolveToken(dataset.fileToken, input.targetConnectionId);
      return { ...dataset, path: token.path, fileName: token.name };
    });
    const jobId = randomUUID();
    this.registerJob(jobId, {
      kind: 'file-import',
      connectionIds: [input.targetConnectionId],
      cancelled: false,
      report: [],
      runtimeConnectionId: input.targetConnectionId,
    });
    try {
      await runtime.request<DataJobStartResult>('data-file-import-start', {
        jobId,
        connectionId: input.targetConnectionId,
        datasets,
      });
      return { jobId };
    } catch (error) {
      this.releaseJob(jobId);
      this.jobs.delete(jobId);
      throw error;
    }
  }

  async startConnectionCopy(input: StartConnectionCopyInput): Promise<DataJobStartResult> {
    this.assertConnectionsAvailable([input.sourceConnectionId, input.targetConnectionId]);
    this.requireRuntime(input.sourceConnectionId);
    this.requireRuntime(input.targetConnectionId);
    const jobId = randomUUID();
    this.registerJob(jobId, {
      kind: 'connection-copy',
      connectionIds: [...new Set([input.sourceConnectionId, input.targetConnectionId])],
      cancelled: false,
      report: [],
    });
    const locked: string[] = [];
    try {
      for (const connectionId of [...new Set([input.sourceConnectionId, input.targetConnectionId])]) {
        await this.requireRuntime(connectionId).request('data-transfer-lock', { jobId });
        locked.push(connectionId);
      }
    } catch (error) {
      await Promise.all(locked.map((connectionId) => this.supervisor.get(connectionId)
        ?.request('data-transfer-unlock', { jobId }).catch(() => undefined)));
      this.releaseJob(jobId);
      this.jobs.delete(jobId);
      throw error;
    }
    void this.runConnectionCopy(jobId, input);
    return { jobId };
  }

  async cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.cancelled = true;
    if (job.kind === 'file-import' && job.runtimeConnectionId) {
      const runtime = this.supervisor.get(job.runtimeConnectionId);
      if (runtime) await runtime.request('data-file-import-cancel', { jobId }).catch(() => undefined);
    }
    return true;
  }

  async saveErrorReport(window: BrowserWindow | null, jobId: string): Promise<{ saved: boolean }> {
    const job = this.jobs.get(jobId);
    if (!job) throw appError('NotFound', 'Data transfer job report is no longer available.');
    let report = job.report;
    if (job.kind === 'file-import' && job.runtimeConnectionId) {
      report = await this.requireRuntime(job.runtimeConnectionId)
        .request<TransferErrorEntry[] | null>('data-file-import-report', { jobId }) ?? [];
    }
    const saveOptions = {
      title: 'Save transfer error report',
      defaultPath: `mongog_transfer_errors_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    };
    const selected = window
      ? await dialog.showSaveDialog(window, saveOptions)
      : await dialog.showSaveDialog(saveOptions);
    if (selected.canceled || !selected.filePath) return { saved: false };
    const header = 'dataset,target,source,row,category,message\r\n';
    const lines = report.map((entry) => [
      entry.dataset,
      entry.target,
      entry.sourceId ?? '',
      'row' in entry ? String((entry as TransferErrorEntry & { row?: number }).row ?? '') : '',
      entry.category,
      entry.message,
    ].map(csvCell).join(',')).join('\r\n');
    await fs.writeFile(selected.filePath, `\uFEFF${header}${lines}${lines ? '\r\n' : ''}`, { mode: 0o600 });
    return { saved: true };
  }

  dispose(): void {
    for (const job of this.jobs.values()) job.cancelled = true;
    this.jobs.clear();
    this.tokens.clear();
    this.lockedConnections.clear();
  }

  private async runConnectionCopy(jobId: string, input: StartConnectionCopyInput): Promise<void> {
    const job = this.jobs.get(jobId)!;
    const source = this.requireRuntime(input.sourceConnectionId);
    const target = this.requireRuntime(input.targetConnectionId);
    const startedAt = Date.now();
    const summaries: DataDatasetSummary[] = [];
    let rowsRead = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    let activeCursorId: string | undefined;
    const send = (
      status: DataJobProgressEvent['status'],
      phase: DataJobProgressEvent['phase'],
      datasetIndex: number,
      message?: string,
      summary?: DataJobSummary,
    ) => this.emit('progress', {
      jobId,
      kind: 'connection-copy',
      status,
      phase,
      connectionIds: job.connectionIds,
      datasetIndex,
      datasetCount: input.datasets.length,
      ...(input.datasets[datasetIndex]
        ? { datasetName: `${input.datasets[datasetIndex]!.sourceDatabase}.${input.datasets[datasetIndex]!.sourceCollection}` }
        : {}),
      rowsRead,
      inserted,
      updated,
      skipped,
      errors,
      ...(message ? { message } : {}),
      ...(summary ? { summary } : {}),
      hasErrorReport: job.report.length > 0,
    } satisfies DataJobProgressEvent);

    try {
      send('preparing', 'preflight', 0, 'Validating source filters and target mappings…');
      for (let datasetIndex = 0; datasetIndex < input.datasets.length; datasetIndex += 1) {
        const dataset = input.datasets[datasetIndex]!;
        assertCopyNotCancelled(job);
        if (
          input.sourceConnectionId === input.targetConnectionId &&
          dataset.sourceDatabase === dataset.targetDatabase &&
          dataset.sourceCollection === dataset.targetCollection
        ) throw appError('Validation', 'Source and target namespace must be different.');

        const datasetSummary: DataDatasetSummary = {
          source: `${dataset.sourceDatabase}.${dataset.sourceCollection}`,
          target: `${dataset.targetDatabase}.${dataset.targetCollection}`,
          inserted: 0,
          updated: 0,
          skipped: 0,
          errors: 0,
        };
        summaries.push(datasetSummary);
        let metadata: SourceMetadata = { indexesEjson: [] };
        if (dataset.metadata.collectionOptions || dataset.metadata.validationRules || dataset.metadata.indexes) {
          metadata = await source.request<SourceMetadata>('data-source-metadata', {
            database: dataset.sourceDatabase,
            collection: dataset.sourceCollection,
          });
          await target.request('data-target-prepare', {
            database: dataset.targetDatabase,
            collection: dataset.targetCollection,
            sourceMetadata: metadata,
            selection: dataset.metadata,
          });
        }

        const opened = await source.request<{ cursorId: string }>('data-source-open', {
          database: dataset.sourceDatabase,
          collection: dataset.sourceCollection,
          filterSource: dataset.filterSource,
        });
        activeCursorId = opened.cursorId;
        for (;;) {
          assertCopyNotCancelled(job);
          const batch = await source.request<{ documentsEjson: string[]; hasMore: boolean }>('data-source-next', {
            cursorId: activeCursorId,
          });
          if (batch.documentsEjson.length > 0) {
            rowsRead += batch.documentsEjson.length;
            const write = await target.request<TransferWriteResult>('data-target-write', {
              write: {
                database: dataset.targetDatabase,
                collection: dataset.targetCollection,
                documentsEjson: batch.documentsEjson,
                conflictMode: dataset.conflictMode,
                rowErrorPolicy: dataset.rowErrorPolicy,
                upsertFields: dataset.upsertFields,
              },
            });
            inserted += write.inserted;
            updated += write.updated;
            skipped += write.skipped;
            errors += write.errors.length;
            datasetSummary.inserted += write.inserted;
            datasetSummary.updated += write.updated;
            datasetSummary.skipped += write.skipped;
            datasetSummary.errors += write.errors.length;
            for (const item of write.errors) {
              job.report.push({
                dataset: datasetSummary.source,
                target: datasetSummary.target,
                ...(item.sourceId ? { sourceId: item.sourceId } : {}),
                category: item.category,
                message: item.message,
              });
            }
            send('running', 'writing', datasetIndex);
          }
          if (!batch.hasMore) break;
        }
        activeCursorId = undefined;
        if (dataset.metadata.indexes) {
          send('running', 'metadata', datasetIndex, 'Creating target indexes…');
          await target.request('data-target-finalize-indexes', {
            database: dataset.targetDatabase,
            collection: dataset.targetCollection,
            sourceMetadata: metadata,
            selection: dataset.metadata,
          });
        }
      }
      const summary: DataJobSummary = {
        jobId,
        kind: 'connection-copy',
        status: 'completed',
        startedAt,
        completedAt: Date.now(),
        datasets: summaries,
        inserted,
        updated,
        skipped,
        errors,
      };
      send('completed', 'finalizing', Math.max(0, input.datasets.length - 1), 'Copy completed. Source data was not modified.', summary);
    } catch (error) {
      const cancelled = job.cancelled;
      const safe = serializeError(error);
      const status = cancelled ? 'cancelled' : 'failed';
      const summary: DataJobSummary = {
        jobId,
        kind: 'connection-copy',
        status,
        startedAt,
        completedAt: Date.now(),
        datasets: summaries,
        inserted,
        updated,
        skipped,
        errors: errors + (cancelled ? 0 : 1),
      };
      send(status, 'finalizing', Math.max(0, summaries.length - 1), cancelled ? 'Copy cancelled. Source data was not modified.' : safe.message, summary);
    } finally {
      if (activeCursorId) {
        await source.request('data-source-close', { cursorId: activeCursorId }).catch(() => undefined);
      }
      await Promise.all(job.connectionIds.map((connectionId) => this.supervisor.get(connectionId)
        ?.request('data-transfer-unlock', { jobId }).catch(() => undefined)));
      this.releaseJob(jobId);
    }
  }

  private requireRuntime(connectionId: string) {
    const runtime = this.supervisor.get(connectionId);
    if (!runtime) throw appError('ServerSelection', 'Connect the selected connection before starting data transfer.');
    return runtime;
  }

  private resolveToken(tokenId: string, connectionId: string): FileToken {
    this.sweepTokens();
    const token = this.tokens.get(tokenId);
    if (!token || token.expiresAt <= Date.now()) throw appError('NotFound', 'Selected file token expired; choose the file again.');
    if (token.connectionId !== connectionId) throw appError('Validation', 'File token belongs to a different target connection.');
    token.expiresAt = Date.now() + TOKEN_TTL_MS;
    return token;
  }

  private sweepTokens(): void {
    const now = Date.now();
    for (const [id, token] of this.tokens) if (token.expiresAt <= now) this.tokens.delete(id);
  }

  private assertConnectionsAvailable(connectionIds: string[]): void {
    for (const connectionId of new Set(connectionIds)) {
      const owner = this.lockedConnections.get(connectionId);
      if (owner) throw appError('Validation', 'A large data job is already using one of the selected connections.');
    }
  }

  private registerJob(jobId: string, job: ManagedJob): void {
    this.jobs.set(jobId, job);
    for (const connectionId of job.connectionIds) this.lockedConnections.set(connectionId, jobId);
  }

  private releaseJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    for (const connectionId of job.connectionIds) {
      if (this.lockedConnections.get(connectionId) === jobId) this.lockedConnections.delete(connectionId);
    }
  }

  private failJobsForConnection(connectionId: string): void {
    for (const [jobId, job] of this.jobs) {
      if (!job.connectionIds.includes(connectionId) || job.cancelled) continue;
      job.cancelled = true;
      this.emit('progress', {
        jobId,
        kind: job.kind,
        status: 'failed',
        phase: 'finalizing',
        connectionIds: job.connectionIds,
        datasetIndex: 0,
        datasetCount: 0,
        rowsRead: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: 1,
        message: 'A connection runtime exited before data transfer completed.',
      } satisfies DataJobProgressEvent);
      this.releaseJob(jobId);
    }
  }
}

function assertCopyNotCancelled(job: ManagedJob): void {
  if (job.cancelled) throw appError('Cancellation', 'Data transfer was cancelled.');
}

function isTerminal(status: DataJobProgressEvent['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function pathSafeError(error: unknown, path: string, fallback: string) {
  const safe = serializeError(error);
  const message = safe.message.includes(path)
    ? safe.message.split(path).join('[selected file]')
    : safe.message || fallback;
  return appError(safe.category, message);
}
