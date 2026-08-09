import { randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { basename, extname } from 'node:path';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse';
import {
  Decimal128,
  EJSON,
  Int32,
  Long,
  ObjectId,
  type Document,
} from 'bson';
import type { MongoClient } from 'mongodb';
import type {
  DataDatasetSummary,
  DataFilePreview,
  DataJobProgressEvent,
  DataJobSummary,
  FileColumnMapping,
  FileColumnType,
  FileImportDataset,
} from '../../shared/domain/index.js';
import { appError, serializeError } from '../../shared/errors/index.js';
import { parseQueryDocumentExpression } from '../collection/operations.js';
import {
  TRANSFER_MAX_BATCH_BYTES,
  TRANSFER_MAX_BATCH_DOCUMENTS,
  setPath,
  writeTransferBatch,
} from './write.js';

export interface RuntimeFileDescriptor {
  path: string;
  token: string;
  name: string;
  format: 'csv' | 'xlsx';
  size: number;
  sheets: string[];
}

export interface RuntimeFileDataset extends FileImportDataset {
  path: string;
  fileName: string;
}

interface ErrorReportEntry {
  dataset: string;
  target: string;
  row: number;
  category: string;
  message: string;
}

interface JobState {
  cancelled: boolean;
  active: boolean;
  report: ErrorReportEntry[];
}

export class FileImportManager {
  private readonly jobs = new Map<string, JobState>();

  constructor(private readonly emit: (event: DataJobProgressEvent) => void) {}

  get hasActiveJob(): boolean {
    return [...this.jobs.values()].some((state) => state.active);
  }

  async inspect(path: string, token: string): Promise<RuntimeFileDescriptor> {
    const stat = await fs.stat(path);
    const extension = extname(path).toLowerCase();
    if (extension !== '.csv' && extension !== '.xlsx') {
      throw appError('Validation', 'Only .csv and .xlsx files are supported.');
    }
    const sheets = extension === '.xlsx' ? await listWorkbookSheets(path) : [];
    return {
      path,
      token,
      name: basename(path),
      format: extension === '.csv' ? 'csv' : 'xlsx',
      size: stat.size,
      sheets,
    };
  }

  async preview(path: string, fileToken: string, sheet?: string, delimiter?: string): Promise<DataFilePreview> {
    const extension = extname(path).toLowerCase();
    const preview = extension === '.csv'
      ? await previewCsv(path, delimiter)
      : await previewXlsx(path, sheet);
    return { fileToken, ...preview };
  }

  start(client: MongoClient, connectionId: string, datasets: RuntimeFileDataset[], requestedJobId?: string): { jobId: string } {
    if (this.hasActiveJob) {
      throw appError('Validation', 'This connection already has an active file import.');
    }
    const jobId = requestedJobId ?? randomUUID();
    this.jobs.set(jobId, { cancelled: false, active: true, report: [] });
    // Defer work until the start response has crossed the utility-process
    // boundary so main can register locks/audit correlation before events.
    setImmediate(() => { void this.run(client, connectionId, jobId, datasets); });
    return { jobId };
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.cancelled = true;
    return true;
  }

  report(jobId: string): ErrorReportEntry[] | null {
    return this.jobs.get(jobId)?.report ?? null;
  }

  async dispose(): Promise<void> {
    for (const job of this.jobs.values()) {
      job.cancelled = true;
      job.active = false;
    }
  }

  private async run(
    client: MongoClient,
    connectionId: string,
    jobId: string,
    datasets: RuntimeFileDataset[],
  ): Promise<void> {
    const job = this.jobs.get(jobId)!;
    const startedAt = Date.now();
    const summaries: DataDatasetSummary[] = [];
    let rowsRead = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const send = (
      status: DataJobProgressEvent['status'],
      phase: DataJobProgressEvent['phase'],
      datasetIndex: number,
      message?: string,
      summary?: DataJobSummary,
    ) => this.emit({
      jobId,
      kind: 'file-import',
      status,
      phase,
      connectionIds: [connectionId],
      datasetIndex,
      datasetCount: datasets.length,
      ...(datasets[datasetIndex] ? { datasetName: datasetLabel(datasets[datasetIndex]!) } : {}),
      rowsRead,
      inserted,
      updated,
      skipped,
      errors,
      ...(message ? { message } : {}),
      ...(summary ? { summary } : {}),
      hasErrorReport: job.report.length > 0,
    });

    try {
      send('preparing', 'preflight', 0, 'Validating file mappings…');
      for (let datasetIndex = 0; datasetIndex < datasets.length; datasetIndex += 1) {
        const dataset = datasets[datasetIndex]!;
        assertNotCancelled(job);
        const datasetSummary: DataDatasetSummary = {
          source: datasetLabel(dataset),
          target: `${dataset.targetDatabase}.${dataset.targetCollection}`,
          inserted: 0,
          updated: 0,
          skipped: 0,
          errors: 0,
        };
        summaries.push(datasetSummary);
        const batch: string[] = [];
        const batchRows: number[] = [];
        let batchBytes = 0;

        const flush = async () => {
          if (batch.length === 0) return;
          assertNotCancelled(job);
          const write = await writeTransferBatch(client, {
            database: dataset.targetDatabase,
            collection: dataset.targetCollection,
            documentsEjson: batch,
            conflictMode: dataset.conflictMode,
            rowErrorPolicy: dataset.rowErrorPolicy,
            upsertFields: dataset.upsertFields,
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
              dataset: datasetLabel(dataset),
              target: datasetSummary.target,
              row: batchRows[item.index] ?? -1,
              category: item.category,
              message: item.message,
            });
          }
          batch.length = 0;
          batchRows.length = 0;
          batchBytes = 0;
          send('running', 'writing', datasetIndex);
        };

        for await (const row of readDatasetRows(dataset)) {
          assertNotCancelled(job);
          rowsRead += 1;
          try {
            const document = mapFileRow(row.values, dataset.mappings, dataset.emptyCellPolicy);
            const ejson = EJSON.stringify(document, undefined, 0, { relaxed: false });
            const bytes = Buffer.byteLength(ejson);
            if (bytes > TRANSFER_MAX_BATCH_BYTES) {
              throw appError('Validation', 'Mapped document exceeds the 8 MiB transfer batch limit.');
            }
            if (
              batch.length > 0 &&
              (batch.length >= TRANSFER_MAX_BATCH_DOCUMENTS || batchBytes + bytes > TRANSFER_MAX_BATCH_BYTES)
            ) await flush();
            batch.push(ejson);
            batchRows.push(row.number);
            batchBytes += bytes;
          } catch (error) {
            const safe = serializeError(error);
            errors += 1;
            datasetSummary.errors += 1;
            job.report.push({
              dataset: datasetLabel(dataset),
              target: datasetSummary.target,
              row: row.number,
              category: safe.category,
              message: safe.message,
            });
            if (dataset.rowErrorPolicy === 'stop') throw error;
            skipped += 1;
            datasetSummary.skipped += 1;
          }
          if (rowsRead % 100 === 0) send('running', 'reading', datasetIndex);
        }
        await flush();
      }
      const summary: DataJobSummary = {
        jobId,
        kind: 'file-import',
        status: 'completed',
        startedAt,
        completedAt: Date.now(),
        datasets: summaries,
        inserted,
        updated,
        skipped,
        errors,
      };
      send('completed', 'finalizing', Math.max(0, datasets.length - 1), 'Import completed.', summary);
    } catch (error) {
      const cancelled = job.cancelled;
      const safe = sanitizeFileJobError(error, datasets);
      const status = cancelled ? 'cancelled' : 'failed';
      const summary: DataJobSummary = {
        jobId,
        kind: 'file-import',
        status,
        startedAt,
        completedAt: Date.now(),
        datasets: summaries,
        inserted,
        updated,
        skipped,
        errors: errors + (cancelled ? 0 : 1),
      };
      send(status, 'finalizing', Math.max(0, summaries.length - 1), cancelled ? 'Import cancelled.' : safe.message, summary);
    } finally {
      job.active = false;
    }
  }
}

export function inferColumnType(column: string, values: unknown[]): FileColumnType {
  const present = values.filter((value) => value !== null && value !== undefined && value !== '');
  if (present.length === 0) return 'string';
  if (present.every((value) => typeof value === 'boolean' || /^(true|false)$/i.test(String(value)))) return 'boolean';
  const strings = present.map(String);
  if (strings.some((value) => /^[-+]?0\d+/.test(value))) return 'string';
  if (column === '_id' && strings.every((value) => /^[0-9a-f]{24}$/i.test(value))) return 'objectId';
  if (present.every((value) => typeof value === 'number' || /^[-+]?\d+$/.test(String(value)))) {
    return strings.every((value) => {
      const number = Number(value);
      return Number.isSafeInteger(number) && number >= -2_147_483_648 && number <= 2_147_483_647;
    }) ? 'int32' : 'long';
  }
  if (present.every((value) => typeof value === 'number' || /^[-+]?(?:\d+\.\d+|\d+e[-+]?\d+)$/i.test(String(value)))) return 'double';
  if (present.every((value) => !Number.isNaN(Date.parse(String(value))))) return 'date';
  return 'string';
}

export function mapFileRow(
  row: Record<string, unknown>,
  mappings: FileColumnMapping[],
  emptyPolicy: FileImportDataset['emptyCellPolicy'],
): Document {
  const document = Object.create(null) as Document;
  for (const mapping of mappings) {
    if (!mapping.included) continue;
    const raw = row[mapping.sourceColumn];
    const empty = raw === '' || raw === null || raw === undefined;
    if (empty && emptyPolicy === 'omit') continue;
    const value = empty
      ? emptyPolicy === 'null' ? null : ''
      : convertColumnValue(raw, mapping.type);
    if (mapping.literalFieldName) document[mapping.targetField] = value;
    else setPath(document, mapping.targetField, value);
  }
  return document;
}

export function convertColumnValue(raw: unknown, type: FileColumnType): unknown {
  if (type === 'string') return typeof raw === 'string' ? raw : String(raw);
  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (/^true$/i.test(String(raw))) return true;
    if (/^false$/i.test(String(raw))) return false;
    throw appError('Validation', `"${String(raw)}" is not a boolean.`);
  }
  if (type === 'int32') {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
      throw appError('Validation', `"${String(raw)}" is not an Int32.`);
    }
    return new Int32(value);
  }
  if (type === 'long') {
    if (!/^[-+]?\d+$/.test(String(raw))) throw appError('Validation', `"${String(raw)}" is not a Long.`);
    return Long.fromString(String(raw));
  }
  if (type === 'double') {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw appError('Validation', `"${String(raw)}" is not a Double.`);
    return value;
  }
  if (type === 'decimal128') return Decimal128.fromString(String(raw));
  if (type === 'date') {
    const value = raw instanceof Date ? raw : new Date(String(raw));
    if (Number.isNaN(value.getTime())) throw appError('Validation', `"${String(raw)}" is not a Date.`);
    return value;
  }
  if (type === 'objectId') {
    if (!ObjectId.isValid(String(raw))) throw appError('Validation', `"${String(raw)}" is not an ObjectId.`);
    return new ObjectId(String(raw));
  }
  try {
    return EJSON.parse(String(raw), { relaxed: false });
  } catch {
    const wrapped = parseQueryDocumentExpression(`{ value: ${String(raw)} }`, 'JSON/EJSON cell');
    return wrapped.value;
  }
}

async function previewCsv(path: string, requestedDelimiter?: string): Promise<Omit<DataFilePreview, 'fileToken'>> {
  const delimiter = requestedDelimiter ?? await detectCsvDelimiter(path);
  const rows: Array<Record<string, string | number | boolean | null>> = [];
  let headers: string[] = [];
  let recordIndex = 0;
  const parser = createReadStream(path).pipe(parse({ delimiter, bom: true, relax_column_count: false }));
  for await (const record of parser as AsyncIterable<string[]>) {
    recordIndex += 1;
    if (recordIndex === 1) {
      headers = normalizeHeaders(record);
      continue;
    }
    rows.push(Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ''])));
    if (rows.length >= 101) break;
  }
  return makePreview(headers, rows, delimiter);
}

async function previewXlsx(path: string, selectedSheet?: string): Promise<Omit<DataFilePreview, 'fileToken'>> {
  let headers: string[] = [];
  const rows: Array<Record<string, string | number | boolean | null>> = [];
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
  });
  for await (const worksheet of workbook) {
    if (selectedSheet && worksheetName(worksheet) !== selectedSheet) continue;
    let rowIndex = 0;
    for await (const row of worksheet) {
      rowIndex += 1;
      const values = rowValues(row);
      if (rowIndex === 1) {
        headers = normalizeHeaders(values.map((value) => String(value ?? '')));
        continue;
      }
      rows.push(Object.fromEntries(headers.map((header, index) => [header, previewCell(values[index])])));
      if (rows.length >= 101) break;
    }
    break;
  }
  if (headers.length === 0) throw appError('Validation', `Excel sheet not found or empty: ${selectedSheet ?? 'first sheet'}`);
  return makePreview(headers, rows);
}

function makePreview(
  headers: string[],
  inputRows: Array<Record<string, string | number | boolean | null>>,
  delimiter?: string,
): Omit<DataFilePreview, 'fileToken'> {
  const rows = inputRows.slice(0, 100);
  return {
    headers,
    rows,
    suggestedMappings: headers.map((header) => ({
      sourceColumn: header,
      included: true,
      targetField: header,
      type: inferColumnType(header, rows.map((row) => row[header])),
    })),
    ...(delimiter ? { delimiter } : {}),
    truncated: inputRows.length > 100,
  };
}

async function* readDatasetRows(
  dataset: RuntimeFileDataset,
): AsyncGenerator<{ number: number; values: Record<string, unknown> }> {
  if (extname(dataset.path).toLowerCase() === '.csv') {
    const delimiter = dataset.delimiter ?? await detectCsvDelimiter(dataset.path);
    const parser = createReadStream(dataset.path).pipe(parse({ delimiter, bom: true, relax_column_count: false }));
    let headers: string[] = [];
    let number = 0;
    for await (const record of parser as AsyncIterable<string[]>) {
      number += 1;
      if (number === 1) {
        headers = normalizeHeaders(record);
        continue;
      }
      yield { number, values: Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ''])) };
    }
    return;
  }

  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(dataset.path, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore',
  });
  for await (const worksheet of workbook) {
    if (dataset.sheet && worksheetName(worksheet) !== dataset.sheet) continue;
    let headers: string[] = [];
    let number = 0;
    for await (const row of worksheet) {
      number += 1;
      const values = rowValues(row);
      if (number === 1) {
        headers = normalizeHeaders(values.map((value) => String(value ?? '')));
        continue;
      }
      yield {
        number,
        values: Object.fromEntries(headers.map((header, index) => [header, importCell(values[index], number, header)])),
      };
    }
    return;
  }
  throw appError('Validation', `Excel sheet not found: ${dataset.sheet ?? 'first sheet'}`);
}

async function listWorkbookSheets(path: string): Promise<string[]> {
  const sheets: string[] = [];
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    worksheets: 'emit', sharedStrings: 'ignore', hyperlinks: 'ignore', styles: 'ignore',
  });
  for await (const worksheet of workbook) sheets.push(worksheetName(worksheet));
  return sheets;
}

export async function detectCsvDelimiter(path: string): Promise<string> {
  const file = await fs.open(path, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '');
    const firstRecord = firstLogicalCsvRecord(sample);
    const candidates = [',', ';', '\t', '|'];
    return candidates
      .map((delimiter) => ({ delimiter, count: countOutsideQuotes(firstRecord, delimiter) }))
      .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ',';
  } finally {
    await file.close();
  }
}

function firstLogicalCsvRecord(text: string): string {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (text[index] === '\n' || text[index] === '\r')) {
      return text.slice(0, index);
    }
  }
  return text;
}

function countOutsideQuotes(text: string, delimiter: string): number {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && text[index] === delimiter) count += 1;
  }
  return count;
}

function normalizeHeaders(values: string[]): string[] {
  const headers = values.map((value) => value.trim());
  if (headers.some((value) => !value)) throw appError('Validation', 'Every source column must have a header.');
  const normalized = headers.map((value) => value.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) throw appError('Validation', 'Source column headers must be unique.');
  return headers;
}

function rowValues(row: ExcelJS.Row): unknown[] {
  const values = Array.isArray(row.values) ? row.values.slice(1) : [];
  return values;
}

function previewCell(value: unknown): string | number | boolean | null {
  const resolved = resolveExcelCell(value, false, -1, 'preview');
  if (resolved === null || typeof resolved === 'string' || typeof resolved === 'number' || typeof resolved === 'boolean') return resolved;
  if (resolved instanceof Date) return resolved.toISOString();
  return JSON.stringify(resolved);
}

function importCell(value: unknown, row: number, column: string): unknown {
  return resolveExcelCell(value, true, row, column);
}

function resolveExcelCell(value: unknown, failMissingFormula: boolean, row: number, column: string): unknown {
  if (value && typeof value === 'object' && 'formula' in value) {
    const result = (value as { result?: unknown }).result;
    if (result === undefined && failMissingFormula) {
      throw appError('Validation', `Formula at row ${row}, column "${column}" has no cached result.`);
    }
    return result ?? null;
  }
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text);
  if (value && typeof value === 'object' && 'richText' in value) {
    return (value as { richText: Array<{ text: string }> }).richText.map((part) => part.text).join('');
  }
  return value ?? '';
}

function assertNotCancelled(job: JobState): void {
  if (job.cancelled) throw appError('Cancellation', 'Data import was cancelled.');
}

function worksheetName(worksheet: ExcelJS.stream.xlsx.WorksheetReader): string {
  return (worksheet as ExcelJS.stream.xlsx.WorksheetReader & { name: string }).name;
}

function sanitizeFileJobError(error: unknown, datasets: RuntimeFileDataset[]) {
  const safe = serializeError(error);
  let message = safe.message;
  for (const dataset of datasets) message = message.split(dataset.path).join('[selected file]');
  return { ...safe, message };
}

function datasetLabel(dataset: RuntimeFileDataset): string {
  return dataset.sheet ? `${dataset.fileName} / ${dataset.sheet}` : dataset.fileName;
}
