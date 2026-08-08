import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import ExcelJS from 'exceljs';
import { Double, EJSON, Int32 } from 'bson';
import type { Document, Filter, FindOptions, MongoClient, Sort } from 'mongodb';
import type {
  ExportFormat,
  ExportProgressEvent,
  ExportScope,
  QueryExportValue,
} from '../../shared/domain/index.js';
import { renderBson, type BsonDisplayMode, type EjsonEnvelope } from '../../shared/ejson/index.js';
import { appError, serializeError } from '../../shared/errors/index.js';
import { parseQueryDocumentExpression } from '../collection/operations.js';
import { CursorRegistry } from '../registry/cursors.js';

const EXPORT_TEMP_PREFIX = 'mongog-export-';
const STALE_TEMP_MS = 24 * 60 * 60 * 1_000;
const EXPORT_BATCH_SIZE = 500;
const EXCEL_MAX_COLUMNS = 16_384;
const EXCEL_DATA_ROWS_PER_SHEET = 1_048_575;
const EXCEL_MAX_CELL_LENGTH = 32_767;
const EXCEL_TRUNCATION_SUFFIX = '… [truncated for Excel; use CSV/TXT for the full value]';
const UTF8_BOM = '\uFEFF';

export interface RuntimeCollectionExportRequest {
  jobId: string;
  connectionId: string;
  destinationPath: string;
  filename: string;
  database: string;
  collection: string;
  cursorId?: string;
  scope: ExportScope;
  format: ExportFormat;
  filterEjson: string;
  sortEjson?: string;
  projectionEjson?: string;
  bsonMode: BsonDisplayMode;
  columnOrder?: string[];
}

export interface RuntimeQueryExportRequest {
  jobId: string;
  connectionId: string;
  destinationPath: string;
  filename: string;
  database: string;
  format: ExportFormat;
  bsonMode: BsonDisplayMode;
  result: QueryExportValue;
}

export type RuntimeExportRequest = RuntimeCollectionExportRequest | RuntimeQueryExportRequest;

interface ExportJob {
  controller: AbortController;
  promise: Promise<void>;
}

interface SpoolResult {
  path: string;
  columns: string[];
  rows: number;
  previewWarnings: number;
}

type RowSource = AsyncGenerator<unknown, void, void>;

export class ExportManager {
  private active: { jobId: string; job: ExportJob } | null = null;

  constructor(
    private readonly registry: CursorRegistry,
    private readonly emit: (event: ExportProgressEvent) => void,
  ) {
    void cleanupStaleExportDirectories();
  }

  start(client: MongoClient, request: RuntimeExportRequest): { jobId: string } {
    if (this.active) {
      throw appError('Validation', 'Another export is already running for this connection.', {
        hint: 'Wait for it to finish or cancel it before starting another export.',
      });
    }
    const controller = new AbortController();
    const promise = this.run(client, request, controller.signal)
      .catch(() => undefined)
      .finally(() => {
        if (this.active?.jobId === request.jobId) this.active = null;
      });
    this.active = { jobId: request.jobId, job: { controller, promise } };
    return { jobId: request.jobId };
  }

  cancel(jobId: string): boolean {
    if (this.active?.jobId !== jobId) return false;
    this.active.job.controller.abort();
    return true;
  }

  async dispose(): Promise<void> {
    if (!this.active) return;
    this.active.job.controller.abort();
    await this.active.job.promise;
  }

  private async run(
    client: MongoClient,
    request: RuntimeExportRequest,
    signal: AbortSignal,
  ): Promise<void> {
    let temporaryDirectory: string | null = null;
    const partialPath = `${request.destinationPath}.part-${request.jobId}`;
    let processedRows = 0;
    let warningCount = 0;
    const progress = createProgressReporter((phase, rows, totalRows) => {
      this.emit({
        jobId: request.jobId,
        connectionId: request.connectionId,
        status: 'running',
        phase,
        processedRows: rows,
        ...(totalRows !== undefined ? { totalRows } : {}),
        filename: request.filename,
        warningCount,
      });
    });

    try {
      progress('preparing', 0, undefined, true);
      temporaryDirectory = join(tmpdir(), `${EXPORT_TEMP_PREFIX}${request.jobId}`);
      await mkdir(temporaryDirectory, { recursive: false });
      const spoolPath = join(temporaryDirectory, 'rows.ndjson');
      const source = this.createRowSource(client, request, signal);
      const preferredColumns = 'columnOrder' in request ? request.columnOrder ?? [] : [];
      const spool = await spoolRows(source, spoolPath, preferredColumns, signal, (rows) => {
        processedRows = rows;
        progress('reading', rows);
      });
      warningCount += spool.previewWarnings;
      processedRows = spool.rows;
      progress('writing', 0, spool.rows, true);

      if (request.format === 'xlsx') {
        if (spool.columns.length > EXCEL_MAX_COLUMNS) {
          throw appError(
            'Validation',
            `Excel supports at most ${EXCEL_MAX_COLUMNS.toLocaleString()} columns; this export has ${spool.columns.length.toLocaleString()}.`,
            { hint: 'Choose CSV or TXT to export every column.' },
          );
        }
        warningCount += await writeXlsx(
          spool,
          partialPath,
          request.bsonMode,
          signal,
          (rows) => progress('writing', rows, spool.rows),
        );
      } else {
        await writeDelimited(
          spool,
          partialPath,
          request.format,
          request.bsonMode,
          signal,
          (rows) => progress('writing', rows, spool.rows),
        );
      }

      throwIfAborted(signal);
      progress('finalizing', spool.rows, spool.rows, true);
      await replaceDestination(partialPath, request.destinationPath);
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
      this.emit({
        jobId: request.jobId,
        connectionId: request.connectionId,
        status: 'completed',
        phase: 'finalizing',
        processedRows: spool.rows,
        totalRows: spool.rows,
        filename: request.filename,
        warningCount,
        ...(warningCount > 0
          ? { message: `${warningCount.toLocaleString()} value(s) required an export warning.` }
          : {}),
      });
    } catch (error) {
      await rm(partialPath, { force: true }).catch(() => undefined);
      if (temporaryDirectory) {
        await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      const serialized = serializeError(error);
      const cancelled = signal.aborted || serialized.category === 'Cancellation';
      this.emit({
        jobId: request.jobId,
        connectionId: request.connectionId,
        status: cancelled ? 'cancelled' : 'error',
        phase: 'finalizing',
        processedRows,
        filename: request.filename,
        warningCount,
        message: cancelled
          ? 'Export cancelled.'
          : sanitizeExportErrorMessage(serialized.message, request, partialPath, temporaryDirectory),
      });
      throw error;
    }
  }

  private createRowSource(
    client: MongoClient,
    request: RuntimeExportRequest,
    signal: AbortSignal,
  ): RowSource {
    if ('scope' in request) {
      if (request.scope === 'current-page') {
        return rowsFromCursorPage(this.registry, request.cursorId!, signal);
      }
      return rowsFromCollection(client, this.registry, request, signal);
    }
    if (request.result.kind === 'documents') {
      return rowsFromCursorPage(this.registry, request.result.cursorId, signal);
    }
    return rowsFromQueryValue(request.result, signal);
  }
}

async function* rowsFromCursorPage(
  registry: CursorRegistry,
  cursorId: string,
  signal: AbortSignal,
): RowSource {
  throwIfAborted(signal);
  const snapshot = registry.snapshotCurrentPage(cursorId);
  for (const document of snapshot.documents) {
    throwIfAborted(signal);
    yield document;
  }
}

async function* rowsFromCollection(
  client: MongoClient,
  registry: CursorRegistry,
  request: RuntimeCollectionExportRequest,
  signal: AbortSignal,
): RowSource {
  const filter = parseQueryDocumentExpression(request.filterEjson, 'Filter');
  const sort = request.sortEjson
    ? parseQueryDocumentExpression(request.sortEjson, 'Sort')
    : undefined;
  const projection = request.projectionEjson
    ? parseQueryDocumentExpression(request.projectionEjson, 'Projection')
    : undefined;
  let cursor = client.db(request.database).collection(request.collection).find(
    filter as Filter<Document>,
    // Atlas shared/serverless tiers reject noCursorTimeout cursors. Export
    // continuously consumes this dedicated cursor, so the normal server idle
    // timeout is sufficient and works across Atlas tiers and local mongod.
    buildExportFindOptions(projection),
  );
  if (sort && Object.keys(sort).length > 0) cursor = cursor.sort(sort as Sort);
  const cursorId = registry.register(cursor, {
    connectionId: request.connectionId,
    resultId: `export:${request.jobId}`,
  }, `${request.database}.${request.collection}`);
  try {
    while (true) {
      throwIfAborted(signal);
      const batch = await registry.fetchRawNext(cursorId, EXPORT_BATCH_SIZE);
      for (const document of batch.documents) {
        throwIfAborted(signal);
        yield document;
      }
      if (!batch.hasMore) break;
    }
  } finally {
    await registry.close(cursorId);
  }
}

/** Atlas shared/serverless tiers reject `noCursorTimeout`; never request it. */
export function buildExportFindOptions(projection?: Document): FindOptions {
  return projection ? { projection } : {};
}

async function* rowsFromQueryValue(result: QueryExportValue, signal: AbortSignal): RowSource {
  throwIfAborted(signal);
  switch (result.kind) {
    case 'scalar':
      yield { $value: envelopeValue(result.value) };
      return;
    case 'command':
      yield envelopeValue(result.value);
      return;
    case 'write':
      yield {
        op: result.op,
        inserted: result.insertedCount ?? 0,
        matched: result.matchedCount ?? 0,
        modified: result.modifiedCount ?? 0,
        deleted: result.deletedCount ?? 0,
        upserted: result.upsertedCount ?? 0,
      };
      return;
    case 'documents':
      return;
  }
}

function envelopeValue(envelope: EjsonEnvelope): unknown {
  if (envelope.truncated) {
    return {
      $preview: envelope.ejson,
      $truncated: true,
      $originalBytes: envelope.byteSize,
    };
  }
  return EJSON.parse(envelope.ejson, { relaxed: false });
}

async function spoolRows(
  source: RowSource,
  spoolPath: string,
  preferredColumns: string[],
  signal: AbortSignal,
  onProgress: (rows: number) => void,
): Promise<SpoolResult> {
  const stream = createWriteStream(spoolPath, { encoding: 'utf8' });
  const columns = new Set<string>();
  let rows = 0;
  let previewWarnings = 0;
  try {
    for await (const value of source) {
      throwIfAborted(signal);
      const flattened = flattenExportRow(value);
      for (const column of Object.keys(flattened)) columns.add(column);
      if (Object.entries(flattened).some(([key, value]) => key.endsWith('$truncated') && value === true)) {
        previewWarnings += 1;
      }
      await writeChunk(stream, `${EJSON.stringify(flattened, undefined, 0, { relaxed: false })}\n`);
      rows += 1;
      if (rows % EXPORT_BATCH_SIZE === 0) onProgress(rows);
    }
    await endStream(stream);
  } catch (error) {
    await destroyStream(stream);
    throw error;
  }
  onProgress(rows);
  return {
    path: spoolPath,
    columns: orderColumns(columns, preferredColumns),
    rows,
    previewWarnings,
  };
}

export function flattenExportRow(value: unknown): Record<string, unknown> {
  const row: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (!isFlattenableDocument(value)) {
    row.$value = value;
    return row;
  }
  flattenInto(row, value, '');
  return row;
}

function flattenInto(target: Record<string, unknown>, value: Record<string, unknown>, prefix: string): void {
  const entries = Object.entries(value);
  if (entries.length === 0 && prefix) target[prefix] = value;
  for (const [key, child] of entries) {
    const path = appendFieldPath(prefix, key);
    if (isFlattenableDocument(child)) flattenInto(target, child, path);
    else target[path] = child;
  }
}

function appendFieldPath(prefix: string, key: string): string {
  const identifier = /^[A-Za-z_$][\w$]*$/u.test(key) && !key.includes('.');
  if (!prefix) return identifier ? key : `[${JSON.stringify(key)}]`;
  return identifier ? `${prefix}.${key}` : `${prefix}[${JSON.stringify(key)}]`;
}

function isFlattenableDocument(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return false;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return false;
  if (typeof (value as { _bsontype?: unknown })._bsontype === 'string') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function orderColumns(columns: Set<string>, preferred: string[]): string[] {
  const ordered: string[] = [];
  if (columns.has('_id')) ordered.push('_id');
  for (const column of preferred) {
    if (columns.has(column) && !ordered.includes(column)) ordered.push(column);
  }
  const remaining = [...columns]
    .filter((column) => column !== '_id' && !ordered.includes(column))
    .sort((left, right) => left.localeCompare(right));
  return [...ordered, ...remaining];
}

async function writeDelimited(
  spool: SpoolResult,
  outputPath: string,
  format: Extract<ExportFormat, 'csv' | 'txt'>,
  mode: BsonDisplayMode,
  signal: AbortSignal,
  onProgress: (rows: number) => void,
): Promise<void> {
  const stream = createWriteStream(outputPath, { encoding: 'utf8' });
  const delimiter = format === 'csv' ? ',' : '\t';
  const encode = format === 'csv' ? encodeCsvCell : encodeTsvCell;
  try {
    await writeChunk(
      stream,
      UTF8_BOM + spool.columns.map((column) => encode(protectSpreadsheetText(column))).join(delimiter) +
        (format === 'csv' ? '\r\n' : '\n'),
    );
    let rows = 0;
    for await (const row of readSpool(spool.path)) {
      throwIfAborted(signal);
      const line = spool.columns
        .map((column) => encode(formatTextValue(row[column], mode)))
        .join(delimiter);
      await writeChunk(stream, line + (format === 'csv' ? '\r\n' : '\n'));
      rows += 1;
      if (rows % EXPORT_BATCH_SIZE === 0) onProgress(rows);
    }
    await endStream(stream);
    onProgress(rows);
  } catch (error) {
    await destroyStream(stream);
    throw error;
  }
}

async function writeXlsx(
  spool: SpoolResult,
  outputPath: string,
  mode: BsonDisplayMode,
  signal: AbortSignal,
  onProgress: (rows: number) => void,
): Promise<number> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: outputPath,
    useSharedStrings: false,
    useStyles: true,
  });
  let worksheet = createWorksheet(workbook, spool.columns, 1);
  let rows = 0;
  let rowsOnSheet = 0;
  let warnings = 0;
  try {
    for await (const row of readSpool(spool.path)) {
      throwIfAborted(signal);
      if (rowsOnSheet >= EXCEL_DATA_ROWS_PER_SHEET) {
        worksheet.commit();
        worksheet = createWorksheet(workbook, spool.columns, Math.floor(rows / EXCEL_DATA_ROWS_PER_SHEET) + 1);
        rowsOnSheet = 0;
      }
      const values = spool.columns.map((column) => {
        const converted = excelCellValue(row[column], mode);
        warnings += converted.warning ? 1 : 0;
        return converted.value;
      });
      worksheet.addRow(values).commit();
      rows += 1;
      rowsOnSheet += 1;
      if (rows % EXPORT_BATCH_SIZE === 0) onProgress(rows);
    }
    worksheet.commit();
    await workbook.commit();
    onProgress(rows);
    return warnings;
  } catch (error) {
    const stream = (workbook as unknown as {
      stream?: NodeJS.WritableStream & { destroy?: () => void };
    }).stream;
    stream?.destroy?.();
    throw error;
  }
}

function createWorksheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  columns: string[],
  index: number,
) {
  const worksheet = workbook.addWorksheet(index === 1 ? 'Data' : `Data ${index}`, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  worksheet.columns = columns.map((column, columnIndex) => ({
    key: `column_${columnIndex}`,
    width: Math.max(10, Math.min(42, column.length + 2)),
  }));
  const header = worksheet.addRow(columns.map(protectSpreadsheetText));
  header.font = { bold: true };
  header.commit();
  if (columns.length > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }
  return worksheet;
}

function excelCellValue(
  value: unknown,
  mode: BsonDisplayMode,
): { value: string | number | boolean | Date | null; warning: boolean } {
  if (value === undefined) return { value: null, warning: false };
  if (value === null) return { value: 'null', warning: false };
  if (typeof value === 'boolean' || typeof value === 'number' || value instanceof Date) {
    return { value, warning: false };
  }
  if (value instanceof Int32 || value instanceof Double) {
    return { value: value.value, warning: false };
  }
  const text = typeof value === 'string' ? protectSpreadsheetText(value) : formatTextValue(value, mode);
  if (text.length <= EXCEL_MAX_CELL_LENGTH) return { value: text, warning: false };
  return {
    value: text.slice(0, EXCEL_MAX_CELL_LENGTH - EXCEL_TRUNCATION_SUFFIX.length) + EXCEL_TRUNCATION_SUFFIX,
    warning: true,
  };
}

function formatTextValue(value: unknown, mode: BsonDisplayMode): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return protectSpreadsheetText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return protectSpreadsheetText(renderBson(value, mode, false));
  } catch {
    return protectSpreadsheetText(String(value));
  }
}

export function protectSpreadsheetText(value: string): string {
  return /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
}

export function encodeCsvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}

export function encodeTsvCell(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/\t/gu, '\\t').replace(/\r/gu, '\\r').replace(/\n/gu, '\\n');
}

async function* readSpool(path: string): AsyncGenerator<Record<string, unknown>, void, void> {
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    yield EJSON.parse(line, { relaxed: false }) as Record<string, unknown>;
  }
}

async function writeChunk(stream: WriteStream, chunk: string): Promise<void> {
  if (stream.write(chunk)) return;
  await once(stream, 'drain');
}

async function endStream(stream: WriteStream): Promise<void> {
  stream.end();
  await once(stream, 'finish');
}

async function destroyStream(stream: WriteStream): Promise<void> {
  if (stream.closed) return;
  const closed = once(stream, 'close').catch(() => undefined);
  stream.destroy();
  await closed;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw appError('Cancellation', 'Export cancelled.');
}

function createProgressReporter(
  emit: (phase: ExportProgressEvent['phase'], rows: number, totalRows?: number) => void,
) {
  let lastEmittedAt = 0;
  return (
    phase: ExportProgressEvent['phase'],
    rows: number,
    totalRows?: number,
    force = false,
  ) => {
    const now = Date.now();
    if (!force && now - lastEmittedAt < 250) return;
    lastEmittedAt = now;
    emit(phase, rows, totalRows);
  };
}

async function replaceDestination(partialPath: string, destinationPath: string): Promise<void> {
  try {
    await rename(partialPath, destinationPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') throw error;
    await rm(destinationPath, { force: true });
    await rename(partialPath, destinationPath);
  }
}

async function cleanupStaleExportDirectories(now = Date.now()): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(tmpdir());
  } catch {
    return;
  }
  await Promise.all(entries
    .filter((entry) => entry.startsWith(EXPORT_TEMP_PREFIX))
    .map(async (entry) => {
      const path = join(tmpdir(), entry);
      try {
        const metadata = await stat(path);
        if (now - metadata.mtimeMs > STALE_TEMP_MS) {
          await rm(path, { recursive: true, force: true });
        }
      } catch {
        // Best-effort cleanup must never prevent the runtime from starting.
      }
    }));
}

function sanitizeExportErrorMessage(
  message: string,
  request: RuntimeExportRequest,
  partialPath: string,
  temporaryDirectory: string | null,
): string {
  let safe = message
    .split(request.destinationPath).join(request.filename)
    .split(partialPath).join(`${request.filename}.part`);
  if (temporaryDirectory) safe = safe.split(temporaryDirectory).join('[temporary export directory]');
  return safe.slice(0, 2_000);
}
