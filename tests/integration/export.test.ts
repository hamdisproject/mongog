import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MongoClient } from 'mongodb';
import { findCollectionDocuments } from '../../src/query-runtime/collection/operations.js';
import { ExportManager } from '../../src/query-runtime/export/export-manager.js';
import { CursorRegistry } from '../../src/query-runtime/registry/cursors.js';
import type { ExportProgressEvent } from '../../src/shared/domain/index.js';
import { getStandaloneUri, newClient, stopAll } from './helpers/mongo.js';

const DATABASE = 'mongog_export';
const COLLECTION = 'large_documents';

describe('streaming export with real mongod', () => {
  let client: MongoClient;
  let registry: CursorRegistry;
  let directory: string;

  beforeAll(async () => {
    client = await newClient(await getStandaloneUri());
    registry = new CursorRegistry();
    directory = await mkdtemp(join(tmpdir(), 'mongog-export-integration-'));
    const collection = client.db(DATABASE).collection(COLLECTION);
    await collection.deleteMany({});
    await collection.insertMany(Array.from({ length: 120 }, (_, n) => ({
      n,
      group: n % 2 === 0 ? 'a' : 'b',
      nested: { rank: n * 2 },
      ignored: `value-${n}`,
    })));
  }, 120_000);

  afterAll(async () => {
    await registry.dispose();
    await client.close();
    await rm(directory, { recursive: true, force: true });
    await stopAll();
  });

  it('exports every matching page with criteria while preserving the browser cursor', async () => {
    const browser = await findCollectionDocuments(client, registry, {
      database: DATABASE,
      collection: COLLECTION,
      owner: { connectionId: 'export-integration', tabId: 'documents-tab' },
      filterEjson: '{}',
      sortEjson: '{ n: 1 }',
      pageSize: 10,
    });
    const before = registry.snapshotCurrentPage(browser.cursorId);
    const destinationPath = join(directory, 'all.csv');
    const events: ExportProgressEvent[] = [];
    const manager = new ExportManager(registry, (event) => events.push(event));

    manager.start(client, {
      jobId: '33333333-3333-4333-8333-333333333333',
      connectionId: 'export-integration',
      destinationPath,
      filename: 'all.csv',
      database: DATABASE,
      collection: COLLECTION,
      scope: 'all-matching',
      format: 'csv',
      filterEjson: "{ group: 'a' }",
      sortEjson: '{ n: -1 }',
      projectionEjson: '{ n: 1, nested: 1, _id: 0 }',
      bsonMode: 'mongosh',
      columnOrder: ['n', 'nested.rank'],
    });

    await waitForTerminal(events);
    const terminal = events.at(-1)!;
    expect(terminal).toMatchObject({ status: 'completed', processedRows: 60 });
    const lines = (await readFile(destinationPath, 'utf8')).replace(/^\uFEFF/u, '').trim().split('\r\n');
    expect(lines).toHaveLength(61);
    expect(lines[0]).toBe('n,nested.rank');
    expect(lines[1]).toBe('118,236');
    expect(lines.at(-1)).toBe('0,0');

    const after = registry.snapshotCurrentPage(browser.cursorId);
    expect(after).toEqual(before);
    expect(registry.metadata(browser.cursorId).pageIndex).toBe(0);
    await manager.dispose();
  });
});

async function waitForTerminal(events: ExportProgressEvent[]): Promise<void> {
  const startedAt = Date.now();
  while (!events.some((event) => event.status !== 'running')) {
    if (Date.now() - startedAt > 30_000) throw new Error('Export did not finish.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

