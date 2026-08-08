import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { ObjectId } from 'bson';
import type { MongoClient } from 'mongodb';
import { afterEach, describe, expect, it } from 'vitest';
import { buildExportFilename, sanitizeFilenamePart } from '../../src/main/export/filename.js';
import {
  encodeCsvCell,
  buildExportFindOptions,
  encodeTsvCell,
  ExportManager,
  flattenExportRow,
  protectSpreadsheetText,
} from '../../src/query-runtime/export/export-manager.js';
import { CursorRegistry } from '../../src/query-runtime/registry/cursors.js';
import type { ExportProgressEvent } from '../../src/shared/domain/index.js';
import { serializeToEjson } from '../../src/shared/ejson/index.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('export formatting', () => {
  it('flattens nested documents while disambiguating literal dotted field names', () => {
    const id = new ObjectId('507f1f77bcf86cd799439011');
    const row = flattenExportRow({
      _id: id,
      address: { city: 'Istanbul', geo: { lat: 41 } },
      'address.city': 'literal',
      tags: ['one', 'two'],
    });

    expect(row._id).toBe(id);
    expect(row['address.city']).toBe('Istanbul');
    expect(row['address.geo.lat']).toBe(41);
    expect(row['["address.city"]']).toBe('literal');
    expect(row.tags).toEqual(['one', 'two']);
  });

  it('escapes delimited text and protects spreadsheet formulas', () => {
    expect(encodeCsvCell('a,"b"\n')).toBe('"a,""b""\n"');
    expect(encodeTsvCell('a\tb\nc\\d')).toBe('a\\tb\\nc\\\\d');
    expect(protectSpreadsheetText(' =HYPERLINK("x")')).toBe('\' =HYPERLINK("x")');
    expect(protectSpreadsheetText('-12')).toBe("'-12");
    expect(protectSpreadsheetText('plain')).toBe('plain');
    expect(protectSpreadsheetText('@dangerous-header')).toBe("'@dangerous-header");
  });

  it('builds portable database/collection/timestamp filenames', () => {
    const date = new Date(2026, 7, 8, 14, 5, 9);
    expect(buildExportFilename('shop/db', 'orders:*', 'csv', date))
      .toBe('shop_db_orders_2026-08-08_14-05-09.csv');
    expect(sanitizeFilenamePart('...bad name.')).toBe('bad_name');
  });

  it('uses Atlas-compatible collection cursor options', () => {
    expect(buildExportFindOptions({ sku: 1 })).toEqual({ projection: { sku: 1 } });
    expect(buildExportFindOptions()).toEqual({});
    expect(buildExportFindOptions({})).not.toHaveProperty('noCursorTimeout');
  });
});

describe('ExportManager', () => {
  it('writes query command rows as UTF-8 CSV without loading a MongoDB cursor', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mongog-export-unit-'));
    cleanup.push(directory);
    const destinationPath = join(directory, 'result.csv');
    const events: ExportProgressEvent[] = [];
    const manager = new ExportManager(new CursorRegistry(), (event) => events.push(event));

    manager.start({} as MongoClient, {
      jobId: '11111111-1111-4111-8111-111111111111',
      connectionId: 'connection-1',
      destinationPath,
      filename: 'result.csv',
      database: 'db',
      format: 'csv',
      bsonMode: 'mongosh',
      result: {
        kind: 'command',
        value: serializeToEjson({ ok: 1, nested: { name: 'İstanbul' }, formula: '=1+1' }),
      },
    });

    await waitForTerminal(events);
    const content = await readFile(destinationPath, 'utf8');
    expect(content.startsWith('\uFEFF')).toBe(true);
    expect(content).toContain('formula,nested.name,ok');
    expect(content).toContain("'=1+1,İstanbul,1");
    expect(events.at(-1)).toMatchObject({ status: 'completed', processedRows: 1 });
    await manager.dispose();
  });

  it('streams XLSX and marks cells that exceed the Excel character limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mongog-export-unit-'));
    cleanup.push(directory);
    const destinationPath = join(directory, 'result.xlsx');
    const events: ExportProgressEvent[] = [];
    const manager = new ExportManager(new CursorRegistry(), (event) => events.push(event));

    manager.start({} as MongoClient, {
      jobId: '22222222-2222-4222-8222-222222222222',
      connectionId: 'connection-1',
      destinationPath,
      filename: 'result.xlsx',
      database: 'db',
      format: 'xlsx',
      bsonMode: 'canonical',
      result: { kind: 'scalar', value: serializeToEjson('x'.repeat(40_000), 100_000) },
    });

    await waitForTerminal(events);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(destinationPath);
    const value = workbook.getWorksheet('Data')!.getCell('A2').value;
    expect(String(value).length).toBe(32_767);
    expect(String(value)).toContain('use CSV/TXT for the full value');
    expect(events.at(-1)).toMatchObject({ status: 'completed', warningCount: 1 });
    await manager.dispose();
  });

  it('cancels an active job and removes partial output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mongog-export-unit-'));
    cleanup.push(directory);
    const destinationPath = join(directory, 'cancelled.txt');
    const events: ExportProgressEvent[] = [];
    const manager = new ExportManager(new CursorRegistry(), (event) => events.push(event));
    const jobId = '44444444-4444-4444-8444-444444444444';

    manager.start({} as MongoClient, {
      jobId,
      connectionId: 'connection-1',
      destinationPath,
      filename: 'cancelled.txt',
      database: 'db',
      format: 'txt',
      bsonMode: 'mongosh',
      result: { kind: 'scalar', value: serializeToEjson('value') },
    });
    expect(manager.cancel(jobId)).toBe(true);
    await waitForTerminal(events);
    expect(events.at(-1)).toMatchObject({ status: 'cancelled' });
    await expect(access(destinationPath)).rejects.toBeTruthy();
    await manager.dispose();
  });
});

async function waitForTerminal(events: ExportProgressEvent[]): Promise<void> {
  const startedAt = Date.now();
  while (!events.some((event) => event.status !== 'running')) {
    if (Date.now() - startedAt > 10_000) throw new Error('Export did not finish.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
