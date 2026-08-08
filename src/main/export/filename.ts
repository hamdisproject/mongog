import type { ExportFormat } from '../../shared/domain/index.js';

const EXTENSIONS: Record<ExportFormat, string> = {
  xlsx: 'xlsx',
  csv: 'csv',
  txt: 'txt',
};

/** Build a portable filename without leaking paths into renderer state. */
export function buildExportFilename(
  database: string,
  collection: string | undefined,
  format: ExportFormat,
  date = new Date(),
  fallback = 'query',
): string {
  const databasePart = sanitizeFilenamePart(database) || 'database';
  const collectionPart = sanitizeFilenamePart(collection ?? fallback) || fallback;
  const timestamp = localTimestamp(date);
  return `${databasePart}_${collectionPart}_${timestamp}.${EXTENSIONS[format]}`;
}

export function sanitizeFilenamePart(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/gu, '_')
    .replace(/\s+/gu, '_')
    .replace(/[._]+$/gu, '')
    .replace(/^\.+/gu, '')
    .slice(0, 80);
}

function localTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function exportDialogFilters(format: ExportFormat): Electron.FileFilter[] {
  switch (format) {
    case 'xlsx': return [{ name: 'Excel Workbook', extensions: ['xlsx'] }];
    case 'csv': return [{ name: 'Comma-separated values', extensions: ['csv'] }];
    case 'txt': return [{ name: 'Tab-separated text', extensions: ['txt'] }];
  }
}

